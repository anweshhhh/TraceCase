export default function DashboardLoading() {
  return (
    <section className="rounded-lg border bg-background p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Loading...</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Fetching workspace data and latest status updates.
      </p>
    </section>
  );
}
