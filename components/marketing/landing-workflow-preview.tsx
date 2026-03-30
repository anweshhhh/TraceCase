"use client";

import { useEffect, useMemo, useState } from "react";
import { IBM_Plex_Mono } from "next/font/google";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500"],
});

const scenes = [
  {
    id: "requirement",
    label: "Requirement",
    caption: "18 criteria detected",
    durationMs: 3200,
  },
  {
    id: "grounding",
    label: "Grounding",
    caption: "3 API ops • 4 models",
    durationMs: 3200,
  },
  {
    id: "draft",
    label: "Reviewable draft",
    caption: "Coverage 18 / 18",
    durationMs: 5600,
  },
] as const;

const requirementLines = [
  "Email OTP login with resend, lockout, and rate-limit handling",
  "Show email and password fields",
  "Valid login creates an OTP challenge",
  "Resend invalidates the previous challenge",
  "Rate limit returns a documented status",
];

const packRows = [
  { title: "Login creates OTP challenge", kind: "Scenario" },
  { title: "POST /auth/verify-otp returns session_id", kind: "API check" },
  { title: "User.lastLoginAt updates on success", kind: "SQL check" },
];

export function LandingWorkflowPreview() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const currentScene = scenes[activeIndex];
    const timer = window.setTimeout(() => {
      setActiveIndex((activeIndex + 1) % scenes.length);
    }, currentScene.durationMs);

    return () => window.clearTimeout(timer);
  }, [activeIndex]);

  const activeScene = scenes[activeIndex];
  const groundingVisible = activeIndex >= 1;
  const draftVisible = activeIndex >= 2;

  const frameTransform = useMemo(() => {
    return `perspective(1800px) rotateX(${pointer.y * -1.6}deg) rotateY(${pointer.x * 2.2}deg)`;
  }, [pointer]);

  const requirementStyles = [
    { left: "2%", top: "1.2rem", width: "72%", scale: 1, opacity: 1, zIndex: 3 },
    { left: "0%", top: "2rem", width: "42%", scale: 0.94, opacity: 1, zIndex: 2 },
    { left: "3%", top: "1rem", width: "24%", scale: 0.92, opacity: 0.92, zIndex: 1 },
  ][activeIndex];

  const groundingStyles = [
    { right: "2%", top: "3.4rem", width: "32%", scale: 0.9, opacity: 0, zIndex: 1 },
    { right: "0%", top: "1.5rem", width: "42%", scale: 1, opacity: 1, zIndex: 3 },
    { right: "2%", top: "0.8rem", width: "18%", scale: 0.92, opacity: 0.95, zIndex: 2 },
  ][activeIndex];

  const draftStyles = [
    { right: "2%", top: "5.2rem", width: "44%", scale: 0.9, opacity: 0.08, zIndex: 1 },
    { right: "2%", top: "5rem", width: "44%", scale: 0.92, opacity: 0.12, zIndex: 1 },
    { right: "0%", top: "1.45rem", width: "68%", scale: 1, opacity: 1, zIndex: 4 },
  ][activeIndex];

  const reviewStatusStyles = [
    { left: "44%", bottom: "1rem", opacity: 0, scale: 0.92 },
    { left: "45%", bottom: "1rem", opacity: 0.18, scale: 0.94 },
    { left: "47%", bottom: "1rem", opacity: 1, scale: 1 },
  ][activeIndex];

  return (
    <section
      aria-label="Autoplay product demo"
      className="relative mx-auto w-full max-w-[40rem]"
      id="sample"
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;

        setPointer({
          x: Number((x * 0.65).toFixed(3)),
          y: Number((y * 0.65).toFixed(3)),
        });
      }}
      onMouseLeave={() => setPointer({ x: 0, y: 0 })}
    >
      <div className="absolute left-8 top-8 h-36 w-44 rounded-full bg-[radial-gradient(circle,rgba(50,104,255,0.16),transparent_68%)] blur-3xl" />
      <div className="absolute bottom-10 right-10 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(20,155,135,0.18),transparent_68%)] blur-3xl" />

      <div
        className="relative overflow-hidden rounded-[2.6rem] border border-black/8 bg-[linear-gradient(180deg,rgba(255,253,248,0.97),rgba(246,240,229,0.92))] p-4 shadow-[0_44px_120px_rgba(15,23,42,0.13)] transition-transform duration-500 ease-out sm:p-5"
        style={{ transform: frameTransform }}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-black/7" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),transparent)]" />

        <div className="relative flex items-center justify-between gap-3 border-b border-black/6 pb-4">
          <div>
            <p
              className={`${plexMono.className} text-[10px] uppercase tracking-[0.28em] text-foreground/42`}
            >
              Product tour
            </p>
            <h2 className="mt-2 text-lg font-medium tracking-tight text-[#14161b]">
              Watch TraceCase work
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {scenes.map((scene, index) => (
              <div className="flex items-center gap-2" key={scene.id}>
                <span
                  className={`h-2 rounded-full transition-all duration-500 ${
                    index === activeIndex
                      ? "w-8 bg-[#14161b]"
                      : index < activeIndex
                        ? "w-4 bg-black/28"
                        : "w-4 bg-black/10"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p
              className={`${plexMono.className} text-[10px] uppercase tracking-[0.24em] text-foreground/42`}
            >
              {activeScene.label}
            </p>
            <p className="mt-2 text-sm text-[#5d6470]">{activeScene.caption}</p>
          </div>
          <div className="rounded-full border border-black/7 bg-white/78 px-3 py-1 text-[11px] font-medium text-foreground/70">
            autoplay
          </div>
        </div>

        <div className="relative mt-5 min-h-[27rem] sm:min-h-[29rem]">
          <div
            className="absolute rounded-[1.95rem] border border-black/7 bg-white/96 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.08)] transition-all duration-700 ease-out"
            style={{
              left: requirementStyles.left,
              top: requirementStyles.top,
              width: requirementStyles.width,
              opacity: requirementStyles.opacity,
              zIndex: requirementStyles.zIndex,
              transform: `translate3d(${pointer.x * -7}px, ${pointer.y * -6}px, 0) scale(${requirementStyles.scale})`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <p
                className={`${plexMono.className} text-[10px] uppercase tracking-[0.24em] text-foreground/42`}
              >
                Requirement
              </p>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-all duration-500 ${
                  activeIndex === 0
                    ? "bg-[#3268ff]/12 text-[#2349bf]"
                    : "bg-black/5 text-foreground/60"
                }`}
              >
                18 ACs
              </span>
            </div>

            {draftVisible ? (
              <div className="mt-4 rounded-[1.35rem] border border-black/6 bg-[#fbfaf7] p-3">
                <div className="space-y-2">
                  <div className="rounded-xl bg-white px-2.5 py-2 text-xs font-medium text-foreground/78 shadow-sm">
                    Email OTP login
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["UI", "API", "SQL"].map((tag) => (
                      <span
                        className="rounded-full border border-black/7 bg-white px-2 py-1 text-[10px] font-medium text-foreground/60"
                        key={tag}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[1.35rem] border border-black/6 bg-[#fbfaf7] p-3">
                <div className="space-y-2.5">
                  {requirementLines.map((line, index) => (
                    <div
                      className={`rounded-xl px-2.5 py-2 text-xs leading-5 transition-all duration-500 ${
                        activeIndex === 0 && index > 2
                          ? "bg-transparent text-foreground/30"
                          : "bg-white text-foreground/78 shadow-sm"
                      }`}
                      key={line}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeIndex === 0 ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-[#5d6470]">
                <span className="inline-flex size-2 animate-pulse rounded-full bg-[#3268ff]" />
                Source text parsed
              </div>
            ) : draftVisible ? (
              <div className="mt-4 text-xs text-[#5d6470]">Requirement summary</div>
            ) : null}
          </div>

          {groundingVisible ? (
            <div className="absolute left-[41%] top-[42%] h-[2px] w-[12%] overflow-hidden rounded-full bg-black/6">
              <div className="h-full w-full animate-pulse rounded-full bg-[linear-gradient(90deg,#3268ff,#149b87)]" />
            </div>
          ) : null}

          <div
            className="absolute rounded-[1.75rem] border border-black/7 bg-white/94 p-4 shadow-[0_22px_42px_rgba(43,89,255,0.12)] transition-all duration-700 ease-out"
            style={{
              right: groundingStyles.right,
              top: groundingStyles.top,
              width: groundingStyles.width,
              opacity: groundingStyles.opacity,
              zIndex: groundingStyles.zIndex,
              transform: `translate3d(${pointer.x * 8}px, ${pointer.y * -7}px, 0) scale(${groundingStyles.scale})`,
            }}
          >
            <p
              className={`${plexMono.className} text-[10px] uppercase tracking-[0.24em] text-foreground/42`}
            >
              Grounding
            </p>

            <div className="mt-3 space-y-2.5">
              <div
                className={`rounded-[1.1rem] border px-3 py-2.5 text-xs transition-all duration-500 ${
                  activeIndex === 1
                    ? "border-sky-200/90 bg-sky-50/85"
                    : "border-sky-200/70 bg-sky-50/70"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#5d6470]">OpenAPI</span>
                  <span className="font-medium text-[#14161b]">3 ops</span>
                </div>
              </div>
              <div
                className={`rounded-[1.1rem] border px-3 py-2.5 text-xs transition-all duration-500 ${
                  activeIndex === 1
                    ? "border-emerald-200/90 bg-emerald-50/85"
                    : "border-emerald-200/70 bg-emerald-50/70"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#5d6470]">Prisma</span>
                  <span className="font-medium text-[#14161b]">4 models</span>
                </div>
              </div>
            </div>

            {activeIndex === 1 ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-[#5d6470]">
                <span className="inline-flex size-2 animate-pulse rounded-full bg-[#149b87]" />
                Artifacts attached
              </div>
            ) : null}
          </div>

          <div
            className="absolute rounded-[2.05rem] border border-white/8 bg-[linear-gradient(180deg,rgba(26,29,38,0.95),rgba(20,22,27,0.97))] p-5 text-white shadow-[0_34px_90px_rgba(15,23,42,0.22)] transition-all duration-700 ease-out"
            style={{
              right: draftStyles.right,
              top: draftStyles.top,
              width: draftStyles.width,
              opacity: draftStyles.opacity,
              zIndex: draftStyles.zIndex,
              transform: `translate3d(${pointer.x * 7}px, ${pointer.y * 5}px, 0) scale(${draftStyles.scale})`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={`${plexMono.className} text-[10px] uppercase tracking-[0.24em] text-white/44`}
                >
                  Draft pack
                </p>
                <h3 className="mt-2 text-base font-medium">
                  {draftVisible ? "Ready for review" : "Generating"}
                </h3>
              </div>

              <div
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-500 ${
                  draftVisible
                    ? "bg-emerald-400/16 text-emerald-100"
                    : "bg-white/10 text-white/56"
                }`}
              >
                {draftVisible ? "18 / 18" : "pending"}
              </div>
            </div>

            <div className="mt-5 space-y-2.5">
              {packRows.map((row) => (
                <div
                  className={`rounded-[1.1rem] border px-3.5 py-3 transition-all duration-500 ${
                    draftVisible
                      ? row.kind === "Scenario"
                        ? "border-emerald-300/18 bg-emerald-400/10 text-white/80"
                        : "border-white/10 bg-white/6 text-white/76"
                      : "border-white/6 bg-white/4 text-white/34"
                  }`}
                  key={row.title}
                >
                  <div className="text-sm">{row.title}</div>
                  <div className="mt-1 text-[11px] text-white/48">{row.kind}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-[1.2rem] border border-white/10 bg-white/6 p-3.5">
              <div className="flex items-center justify-between gap-3 text-xs text-white/54">
                <span>Coverage</span>
                <span>{draftVisible ? "18 / 18" : "pending"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#3268ff,#149b87)] transition-all duration-700 ease-out"
                  style={{
                    width: draftVisible ? "100%" : "16%",
                  }}
                />
              </div>
            </div>

            {draftVisible ? (
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-white/58">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-2 animate-pulse rounded-full bg-emerald-400" />
                  Human review next
                </div>
                <span className="rounded-full border border-emerald-300/18 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-100/86">
                  grounded
                </span>
              </div>
            ) : null}
          </div>

          <div
            className="absolute rounded-[1.45rem] border border-emerald-200/80 bg-white/96 px-4 py-3 shadow-[0_18px_40px_rgba(16,185,129,0.12)] transition-all duration-700 ease-out"
            style={{
              left: reviewStatusStyles.left,
              bottom: reviewStatusStyles.bottom,
              opacity: reviewStatusStyles.opacity,
              transform: `translate3d(${pointer.x * -5}px, ${pointer.y * 5}px, 0) scale(${reviewStatusStyles.scale})`,
            }}
          >
            <p
              className={`${plexMono.className} text-[10px] uppercase tracking-[0.24em] text-foreground/42`}
            >
              Review state
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex size-2 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(34,197,94,0.12)]" />
              <span className="text-sm font-medium text-[#14161b]">
                Ready for human review
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
