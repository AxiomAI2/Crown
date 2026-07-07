import { redirect } from "next/navigation";

// The real moderation / Trust & Safety console lives at /ops (operator-gated). This admin entry used to be a
// "coming soon" stub; it now sends you to the actual pult so there's one place for enforcement, not two.
export default function AdminModerationPage() {
  redirect("/ops");
}
