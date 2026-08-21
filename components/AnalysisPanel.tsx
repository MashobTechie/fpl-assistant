import type { GameweekAnalysis } from "@/lib/ai/schema";
import { Card, ConfidenceBadge, SectionHeading, Severity, StatTile } from "./ui";

const CONFIDENCE_VALUE = { high: 0.8, medium: 0.55, low: 0.3 } as const;

function CaptainCard({
  pick,
  role,
}: {
  pick: GameweekAnalysis["captain"];
  role: "Captain" | "Vice-captain";
}) {
  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface-2] p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-[10px] text-[--color-cyan]">
          {role}
        </span>
      </div>
      <p className="mt-1.5 font-[family-name:--font-display] text-3xl font-bold uppercase leading-none tracking-tight text-[--color-accent]">{pick.name}</p>
      <p className="mt-2 text-sm leading-relaxed text-[--color-ink-muted]">
        {pick.reasoning}
      </p>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="eyebrow shrink-0 pt-0.5 text-[9px] text-[--color-ink-faint]">Ceiling</dt>
          <dd className="text-[--color-ink-muted]">{pick.ceiling}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="eyebrow shrink-0 pt-0.5 text-[9px] text-[--color-ink-faint]">Risk</dt>
          <dd className="text-[--color-ink-muted]">{pick.risk}</dd>
        </div>
      </dl>
    </div>
  );
}

export function AnalysisPanel({
  analysis,
  gameweek,
  optimalPoints,
  formation,
  cached,
  generatedAt,
}: {
  analysis: GameweekAnalysis;
  gameweek: number;
  optimalPoints: number;
  formation: string;
  cached: boolean;
  generatedAt: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>Gameweek {gameweek} verdict</SectionHeading>
          <div className="flex items-center gap-3">
            <ConfidenceBadge value={CONFIDENCE_VALUE[analysis.confidence]} />
            {cached && (
              <span
                title={`Generated ${new Date(generatedAt).toLocaleString()}`}
                className="text-[11px] text-[--color-ink-faint]"
              >
                cached
              </span>
            )}
          </div>
        </div>

        <p className="text-lg font-semibold leading-snug">{analysis.headline}</p>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile
            label="Projected XI"
            value={optimalPoints.toFixed(1)}
            sub={`${formation} · expected points`}
          />
          <StatTile
            label="Confidence"
            value={analysis.confidence}
            sub="model + data quality"
          />
          <StatTile
            label="Captain"
            value={analysis.captain.name}
            sub={`vice: ${analysis.viceCaptain.name}`}
          />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-[--color-ink-muted]">
          {analysis.confidenceReasoning}
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <CaptainCard pick={analysis.captain} role="Captain" />
        <CaptainCard pick={analysis.viceCaptain} role="Vice-captain" />
      </div>

      <Card className="p-5">
        <SectionHeading>The decision this week</SectionHeading>
        <p className="text-sm leading-relaxed text-[--color-ink]">
          {analysis.keyTradeoff}
        </p>
      </Card>

      <Card className="p-5">
        <SectionHeading hint="against the projection-optimal XI">Lineup</SectionHeading>
        <p className="text-sm leading-relaxed text-[--color-ink-muted]">
          {analysis.lineupVerdict}
        </p>

        {analysis.lineupChanges.length > 0 && (
          <ul className="mt-3 space-y-2">
            {analysis.lineupChanges.map((c) => (
              <li
                key={`${c.benchPlayerId}-${c.startPlayerId}`}
                className="rounded-lg border border-[--color-warn]/30 bg-[--color-warn]/5 p-3 text-sm"
              >
                <p className="font-medium">
                  <span className="text-[--color-pink]">{c.benchPlayerName}</span>
                  {" → bench, "}
                  <span className="text-[--color-accent]">{c.startPlayerName}</span>
                  {" → start"}
                </p>
                <p className="mt-1 text-[--color-ink-muted]">{c.reasoning}</p>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 border-t border-[--color-border] pt-3 text-sm leading-relaxed text-[--color-ink-muted]">
          <span className="font-semibold text-[--color-ink-faint]">Bench order: </span>
          {analysis.benchOrderReasoning}
        </p>
      </Card>

      {analysis.boomCandidates.length > 0 && (
        <Card className="p-5">
          <SectionHeading hint="higher ceiling than the projection">
            Boom candidates
          </SectionHeading>
          <ul className="space-y-2.5">
            {analysis.boomCandidates.map((b) => (
              <li key={b.playerId} className="text-sm">
                <span className="font-semibold text-[--color-violet]">{b.name}</span>
                <span className="text-[--color-ink-muted]"> — {b.reasoning}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {analysis.risks.length > 0 && (
        <Card className="p-5">
          <SectionHeading>Risk flags</SectionHeading>
          <ul className="space-y-2.5">
            {analysis.risks.map((r) => (
              <li key={r.playerId} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Severity level={r.severity} />
                <span className="font-semibold">{r.name}</span>
                <span className="text-[--color-ink-muted]">{r.issue}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {analysis.transferIdeas.length > 0 && (
        <Card className="p-5">
          <SectionHeading hint="not yet a full transfer planner">
            Transfer ideas
          </SectionHeading>
          <ul className="space-y-3">
            {analysis.transferIdeas.map((t) => (
              <li
                key={`${t.outPlayerId}-${t.inPlayerId}`}
                className="rounded-lg border border-[--color-border] bg-[--color-surface-2] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[--color-pink]">{t.outName}</span>
                  <span className="text-[--color-ink-faint]">→</span>
                  <span className="font-semibold text-[--color-accent]">{t.inName}</span>
                  <span className="rounded bg-[--color-surface] px-1.5 py-0.5 text-[11px] text-[--color-ink-faint]">
                    {t.horizon === "short_term" ? "1–3 GW" : "5–10 GW"}
                  </span>
                </div>
                <p className="mt-1.5 text-[--color-ink-muted]">{t.reasoning}</p>
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <div className="flex gap-1.5">
                    <dt className="eyebrow text-[9px] text-[--color-ink-faint]">Funding</dt>
                    <dd className="numeric text-[--color-cyan]">{t.funding}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="eyebrow text-[9px] text-[--color-ink-faint]">Gain</dt>
                    <dd className="numeric text-[--color-ink-muted]">{t.expectedGain}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
