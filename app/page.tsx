import Link from "next/link";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { ClientUserButton } from "@/components/clerk/user-button";
import { LandingWorkflowPreview } from "@/components/marketing/landing-workflow-preview";
import { TraceCaseLogo } from "@/components/marketing/tracecase-logo";

const manrope = Manrope({ subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500"],
});

const proofItems = [
  "Grounded by OpenAPI and Prisma",
  "Structured UI, API, and SQL coverage",
  "Human-reviewed before export",
];

export default function Home() {
  return (
    <div
      className={`${manrope.className} min-h-screen bg-[linear-gradient(180deg,#f6f2ea_0%,#efe8dc_44%,#fbf8f2_100%)] text-foreground`}
    >
      <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_16%_14%,rgba(43,89,255,0.12),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(21,154,140,0.14),transparent_28%),radial-gradient(circle_at_top,rgba(255,255,255,0.85),transparent_58%)]" />

      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4 pb-5">
          <Link className="transition-opacity hover:opacity-85" href="/">
            <TraceCaseLogo wordmarkClassName={plexMono.className} />
          </Link>

          <div className="flex items-center gap-2">
            <SignedOut>
              <SignInButton mode="modal">
                <Button className="rounded-full px-5" variant="ghost">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button className="rounded-full px-5">Start free</Button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Button asChild className="rounded-full px-5" variant="outline">
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
              <ClientUserButton />
            </SignedIn>
          </div>
        </header>

        <section className="flex flex-1 flex-col justify-center py-12 sm:py-16 lg:py-20">
          <div className="mx-auto grid w-full max-w-6xl gap-14 lg:grid-cols-[minmax(0,1fr)_34rem] lg:items-center">
            <div className="max-w-2xl">
              <p
                className={`${plexMono.className} text-[11px] font-medium uppercase tracking-[0.3em] text-foreground/52`}
              >
                Grounded QA generation
              </p>
              <h1 className="mt-5 max-w-3xl text-balance text-5xl font-semibold tracking-[-0.07em] text-[#14161b] sm:text-6xl lg:text-[4.9rem] lg:leading-[0.96]">
                Turn product requirements into reviewable QA packs.
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-[#59606c] sm:text-lg">
                Generate a draft pack from a requirement, ground it with
                OpenAPI or Prisma, and review it before release.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  className="rounded-full bg-[#14161b] px-6 py-6 text-sm font-medium text-white hover:bg-[#0f1115]"
                  size="lg"
                >
                  <Link href="#sample">Open sample pack</Link>
                </Button>
                <SignedOut>
                  <SignUpButton mode="modal">
                    <Button
                      className="rounded-full border-black/10 bg-white/75 px-6 py-6 text-sm font-medium text-foreground hover:bg-white"
                      size="lg"
                      variant="outline"
                    >
                      Start free
                    </Button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <Button
                    asChild
                    className="rounded-full px-6 py-6 text-sm font-medium"
                    size="lg"
                    variant="outline"
                  >
                    <Link href="/dashboard">Open dashboard</Link>
                  </Button>
                </SignedIn>
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#5b616c]">
                {proofItems.map((item, index) => (
                  <div className="flex items-center gap-4" key={item}>
                    <span>{item}</span>
                    {index === proofItems.length - 1 ? null : (
                      <span className="hidden text-black/20 sm:inline">•</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <LandingWorkflowPreview />
          </div>
        </section>

        <section className="border-t border-black/6 py-8">
          <div className="flex items-center justify-between gap-4 px-1">
            <p
              className={`${plexMono.className} text-[10px] uppercase tracking-[0.28em] text-foreground/38`}
            >
              Requirement in • grounded when available • review-ready draft out
            </p>
            <p className="hidden text-sm text-[#5e6470] md:block">
              Built to replace blank-page test planning.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
