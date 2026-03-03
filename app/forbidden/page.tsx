import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
        403
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Forbidden
      </h1>
      <p className="mt-3 text-muted-foreground">
        You do not have permission to access this area.
      </p>
      <Button className="mt-6" asChild>
        <Link href="/dashboard">Back to Dashboard</Link>
      </Button>
    </main>
  );
}
