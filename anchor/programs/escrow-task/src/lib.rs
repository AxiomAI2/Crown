//! Некастодиальная эскроу-программа для мини-игры «задание-донат» (Standing) — фаза G3a, devnet.
//! Проектное решение и инварианты — `decisions/0017-escrow-onchain-devnet-design.md`; шов с ядром —
//! ADR 0015; экономика/исходы — `docs/games/escrow-task-spec.md` §6/§10.
//!
//! Принципы (золотые инварианты §4 CLAUDE.md):
//!   * Деньги задания лежат в PDA-эскроу. Получатели (`donor`, `streamer`) и сумма ЗАШИТЫ в аккаунте при
//!     `fund` — НИКТО, включая `resolver`, не может направить средства третьему лицу или изменить сумму.
//!   * Claim-модель (ADR 0015 §7): забирает сам получатель отдельной транзакцией; крутки/keeper нет.
//!   * Не-спорный цикл (fund/accept/reject/mark_done/cancel/resolve_timeout/claim) — БЕЗ ключа оператора.
//!   * Спор в G3a решает `resolve_dispute` ограниченным резолвером (может только выбрать сторону
//!     donor|streamer) — это объявленное bounded-доверие ТОЛЬКО для devnet, см. ADR 0017. На мейннете
//!     заменяется ончейн commit-reveal голосованием (G3b).
//!
//! ⚠️ НЕ СКОМПИЛИРОВАНО в окружении разработки (нет хост-gcc для proc-макросов; нет SOL на деплой —
//!    devnet-фасет 429). Сборка/тест/деплой — по `anchor/BUILD.md` на машине с тулчейном.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

// Заглушка program id (валидный base58); реальный — `anchor keys sync` при деплое.
declare_id!("GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4");

// — Протокольные константы (спека §10: окна/комиссия — НЕ рычаг донора) —
const FEE_BPS: u64 = 300; // 3% с дошедшего доната (§13); на возврат донору комиссии нет (§6).
const BPS_DENOM: u64 = 10_000;
const ACCEPT_WINDOW: i64 = 72 * 60 * 60; // не принял за 72ч → возврат (§6, §11)
const DISPUTE_WINDOW: i64 = 12 * 60 * 60; // окно оспаривания от «Готово» (§10)
const EXEC_WINDOW_MIN: i64 = 60; // коридор срока выполнения (паритет с мок-машиной machine.ts)
const EXEC_WINDOW_MAX: i64 = 90 * 24 * 60 * 60; // ≈3 месяца

#[program]
pub mod escrow_task {
    use super::*;

    /// Донор создаёт задание-донат: заводит эскроу-PDA + хранилище и переводит туда `amount` USDC.
    /// `task_id` — 32-байтовый id задания (хэш game-bus id), `execution_window` — срок на выполнение
    /// (донор предлагает в коридоре, гейтит стример «Принять»). Резолвер спора фиксируется здесь же.
    pub fn fund(
        ctx: Context<Fund>,
        task_id: [u8; 32],
        amount: u64,
        execution_window: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::BadAmount);
        require!(
            (EXEC_WINDOW_MIN..=EXEC_WINDOW_MAX).contains(&execution_window),
            EscrowError::BadWindow
        );
        let now = Clock::get()?.unix_timestamp;
        let e = &mut ctx.accounts.escrow;
        e.task_id = task_id;
        e.donor = ctx.accounts.donor.key();
        e.streamer = ctx.accounts.streamer.key();
        e.treasury = ctx.accounts.treasury.key();
        e.mint = ctx.accounts.mint.key();
        e.resolver = ctx.accounts.resolver.key();
        e.amount = amount;
        e.execution_window = execution_window;
        e.state = TaskState::Pending as u8;
        e.resolution = Resolution::Unresolved as u8;
        e.accept_deadline = now + ACCEPT_WINDOW;
        e.done_deadline = 0;
        e.dispute_deadline = 0;
        e.bump = ctx.bumps.escrow;

        // Деньги донор → эскроу-хранилище (донор подписывает).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.donor_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.donor.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Стример принимает задание (только владелец payout-адреса). Стартует срок выполнения (no-show).
    pub fn accept(ctx: Context<StreamerAction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let e = &mut ctx.accounts.escrow;
        require!(e.state == TaskState::Pending as u8, EscrowError::BadState);
        require!(now <= e.accept_deadline, EscrowError::Expired);
        e.state = TaskState::Accepted as u8;
        e.done_deadline = now + e.execution_window;
        Ok(())
    }

    /// Стример отклоняет задание → возврат донору (деньги сохраняются, §6).
    pub fn reject(ctx: Context<StreamerAction>) -> Result<()> {
        let e = &mut ctx.accounts.escrow;
        require!(
            e.state == TaskState::Pending as u8 || e.state == TaskState::Accepted as u8,
            EscrowError::BadState
        );
        e.resolution = Resolution::ToDonor as u8;
        e.state = TaskState::Resolved as u8;
        Ok(())
    }

    /// Стример отмечает «Готово» → стартует окно оспаривания.
    pub fn mark_done(ctx: Context<StreamerAction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let e = &mut ctx.accounts.escrow;
        require!(e.state == TaskState::Accepted as u8, EscrowError::BadState);
        e.state = TaskState::Done as u8;
        e.dispute_deadline = now + DISPUTE_WINDOW;
        Ok(())
    }

    /// Донор отменяет до принятия (грейс) → возврат донору.
    pub fn cancel(ctx: Context<DonorAction>) -> Result<()> {
        let e = &mut ctx.accounts.escrow;
        require!(e.state == TaskState::Pending as u8, EscrowError::BadState);
        e.resolution = Resolution::ToDonor as u8;
        e.state = TaskState::Resolved as u8;
        Ok(())
    }

    /// Разрешение по таймауту — PERMISSIONLESS (вызывает кто угодно; решает блокчейн по часам, не оператор):
    ///   * Pending и истёк accept → возврат донору (не приняли за 72ч);
    ///   * Accepted и истёк срок выполнения → возврат донору (no-show);
    ///   * Done и истекло окно спора → стримеру (спора не было).
    pub fn resolve_timeout(ctx: Context<ResolveTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let e = &mut ctx.accounts.escrow;
        if e.state == TaskState::Pending as u8 && now > e.accept_deadline {
            e.resolution = Resolution::ToDonor as u8;
        } else if e.state == TaskState::Accepted as u8 && now > e.done_deadline {
            e.resolution = Resolution::ToDonor as u8;
        } else if e.state == TaskState::Done as u8 && now > e.dispute_deadline {
            e.resolution = Resolution::ToStreamer as u8;
        } else {
            return err!(EscrowError::NotDue);
        }
        e.state = TaskState::Resolved as u8;
        Ok(())
    }

    /// Резолвер помечает эскроу СПОРНЫМ (поднят оффчейн-спор) → `resolve_timeout` его больше не трогает,
    /// пока резолвер не закроет спор через `resolve_dispute`. Закрывает гонку «таймаут опередил голосование»
    /// (ADR 0017). Devnet-only bounded-резолвер; на мейннете — ончейн-голосование (G3b).
    pub fn mark_disputed(ctx: Context<ResolveDispute>) -> Result<()> {
        let e = &mut ctx.accounts.escrow;
        require!(e.state == TaskState::Done as u8, EscrowError::BadState);
        e.state = TaskState::Disputed as u8;
        Ok(())
    }

    /// Резолв СПОРА (G3a, bounded): только зафиксированный `resolver` и только выбор стороны.
    /// Получатели/сумма зашиты в эскроу — украсть/перенаправить нельзя. Devnet-only (ADR 0017); на
    /// мейннете заменяется ончейн commit-reveal голосованием (G3b).
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, to_streamer: bool) -> Result<()> {
        let e = &mut ctx.accounts.escrow;
        require!(
            e.state == TaskState::Done as u8 || e.state == TaskState::Disputed as u8,
            EscrowError::BadState
        );
        require!(
            e.resolution == Resolution::Unresolved as u8,
            EscrowError::AlreadyResolved
        );
        e.resolution = if to_streamer {
            Resolution::ToStreamer as u8
        } else {
            Resolution::ToDonor as u8
        };
        e.state = TaskState::Resolved as u8;
        Ok(())
    }

    /// Стример забирает выигранный донат: 97% — на payout-ATA стримера, 3% — в трежери (§13).
    /// Закрывает хранилище и эскроу-аккаунт, рента возвращается донору (он её вносил).
    pub fn claim_streamer(ctx: Context<ClaimStreamer>) -> Result<()> {
        let e = &ctx.accounts.escrow;
        require!(e.state == TaskState::Resolved as u8, EscrowError::BadState);
        require!(
            e.resolution == Resolution::ToStreamer as u8,
            EscrowError::WrongOutcome
        );
        let amount = e.amount;
        let fee = amount * FEE_BPS / BPS_DENOM;
        let net = amount - fee;

        let task_id = e.task_id;
        let bump = e.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", task_id.as_ref(), &[bump]]];

        // 97% стримеру
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.streamer_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            net,
        )?;
        // 3% в трежери
        if fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.treasury_token.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
            )?;
        }
        // Закрыть хранилище → рента донору.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.donor.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        ))?;
        Ok(())
    }

    /// Донор забирает возврат: 100% суммы (§6, комиссии нет). Закрывает хранилище и эскроу, рента донору.
    pub fn claim_donor(ctx: Context<ClaimDonor>) -> Result<()> {
        let e = &ctx.accounts.escrow;
        require!(e.state == TaskState::Resolved as u8, EscrowError::BadState);
        require!(
            e.resolution == Resolution::ToDonor as u8,
            EscrowError::WrongOutcome
        );
        let amount = e.amount;
        let task_id = e.task_id;
        let bump = e.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", task_id.as_ref(), &[bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.donor_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.donor.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        ))?;
        Ok(())
    }
}

// — Состояние —

#[derive(Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum TaskState {
    Pending = 0,
    Accepted = 1,
    Done = 2,
    Resolved = 3,
    Disputed = 4, // оффчейн-спор поднят; resolve_timeout заблокирован до resolve_dispute (ADR 0017)
}

#[derive(Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum Resolution {
    Unresolved = 0,
    ToStreamer = 1,
    ToDonor = 2,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub task_id: [u8; 32],
    pub donor: Pubkey,
    pub streamer: Pubkey,  // payout-владелец: и действует, и получает выигрыш
    pub treasury: Pubkey,  // получатель комиссии 3%
    pub mint: Pubkey,      // USDC mint
    pub resolver: Pubkey,  // bounded-резолвер спора (G3a; уходит в G3b)
    pub amount: u64,
    pub execution_window: i64,
    pub state: u8,
    pub resolution: u8,
    pub accept_deadline: i64,
    pub done_deadline: i64,
    pub dispute_deadline: i64,
    pub bump: u8,
}

// — Контексты аккаунтов —

#[derive(Accounts)]
#[instruction(task_id: [u8; 32])]
pub struct Fund<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(
        init,
        payer = donor,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", task_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = donor,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = donor_token.owner == donor.key() @ EscrowError::BadOwner,
        constraint = donor_token.mint == mint.key() @ EscrowError::BadMint
    )]
    pub donor_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    /// CHECK: только записывается как payout-адрес стримера; проверяется по подписи в accept/claim.
    pub streamer: UncheckedAccount<'info>,
    /// CHECK: только записывается как получатель комиссии; проверяется по owner трежери-ATA в claim.
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: только записывается как bounded-резолвер; проверяется по подписи в resolve_dispute.
    pub resolver: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StreamerAction<'info> {
    #[account(constraint = streamer.key() == escrow.streamer @ EscrowError::Forbidden)]
    pub streamer: Signer<'info>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct DonorAction<'info> {
    #[account(constraint = donor.key() == escrow.donor @ EscrowError::Forbidden)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ResolveTimeout<'info> {
    /// Кто угодно платит за tx — резолв решает только блокчейн по часам.
    pub caller: Signer<'info>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(constraint = resolver.key() == escrow.resolver @ EscrowError::Forbidden)]
    pub resolver: Signer<'info>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ClaimStreamer<'info> {
    #[account(constraint = streamer.key() == escrow.streamer @ EscrowError::Forbidden)]
    pub streamer: Signer<'info>,
    /// CHECK: получатель ренты при закрытии (он её вносил); адрес сверяется с escrow.donor.
    #[account(mut, constraint = donor.key() == escrow.donor @ EscrowError::BadOwner)]
    pub donor: UncheckedAccount<'info>,
    #[account(
        mut,
        close = donor,
        seeds = [b"escrow", escrow.task_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = escrow.mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = streamer_token.owner == escrow.streamer @ EscrowError::BadOwner,
        constraint = streamer_token.mint == escrow.mint @ EscrowError::BadMint
    )]
    pub streamer_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_token.owner == escrow.treasury @ EscrowError::BadOwner,
        constraint = treasury_token.mint == escrow.mint @ EscrowError::BadMint
    )]
    pub treasury_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimDonor<'info> {
    #[account(
        mut,
        constraint = donor.key() == escrow.donor @ EscrowError::Forbidden
    )]
    pub donor: Signer<'info>,
    #[account(
        mut,
        close = donor,
        seeds = [b"escrow", escrow.task_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = escrow.mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = donor_token.owner == escrow.donor @ EscrowError::BadOwner,
        constraint = donor_token.mint == escrow.mint @ EscrowError::BadMint
    )]
    pub donor_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Сумма должна быть положительной")]
    BadAmount,
    #[msg("Срок выполнения вне допустимого коридора")]
    BadWindow,
    #[msg("Недопустимый статус для этого действия")]
    BadState,
    #[msg("Срок истёк")]
    Expired,
    #[msg("Ещё не наступил срок авторазрешения")]
    NotDue,
    #[msg("Исход уже зафиксирован")]
    AlreadyResolved,
    #[msg("Неверный исход для этого claim")]
    WrongOutcome,
    #[msg("Действие запрещено для этого адреса")]
    Forbidden,
    #[msg("Неверный владелец токен-аккаунта")]
    BadOwner,
    #[msg("Неверный mint токен-аккаунта")]
    BadMint,
}
