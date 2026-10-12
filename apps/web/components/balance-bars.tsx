"use client";

import { daysHint, hoursLabel, isNegativeHours, ratio, sumHours, TYPE_LABELS, TYPE_ORDER, TYPE_SHORT, trimHours } from "../lib/format";
import type { Standing } from "../lib/standing";
import { Tag } from "./ui";

function withDays(hours: string, dayLength: number | null): string {
  const hint = daysHint(hours, dayLength);
  return hint ? `${hoursLabel(hours)} (${hint})` : hoursLabel(hours);
}

// the green bar from the brief: one short phrase per type the company knows
export function SummaryBar({ standings, dayLength }: { standings: Standing[]; dayLength: number | null }) {
  return (
    <ul className="summary-bar" aria-label="Summary">
      {TYPE_ORDER.map((type) => {
        const standing = standings.find((s) => s.assignment.type === type);
        const short = TYPE_SHORT[type];
        if (!standing) return <li key={type}>No {short} policy set</li>;
        if (standing.left === null) {
          return (
            <li key={type}>
              {withDays(standing.taken, dayLength)} {short} taken, unlimited
            </li>
          );
        }
        const total = sumHours([standing.taken, standing.left]);
        return (
          <li key={type}>
            {withDays(standing.taken, dayLength)} {short} taken, {trimHours(standing.left)}/{trimHours(total)}h {short} left
            {daysHint(standing.left, dayLength) ? ` (${daysHint(standing.left, dayLength)})` : ""}
          </li>
        );
      })}
    </ul>
  );
}

function Bar({ standing, dayLength }: { standing: Standing; dayLength: number | null }) {
  const { assignment, taken, left } = standing;
  if (left === null) {
    return (
      <div className="bar-row">
        <div className="bar-head">
          <h3>{assignment.policyName}</h3>
          <Tag>{TYPE_LABELS[assignment.type]}</Tag>
          <Tag tone="accent">Unlimited</Tag>
        </div>
        <p className="muted">No balance to track. {withDays(taken, dayLength)} taken this year.</p>
      </div>
    );
  }

  const total = sumHours([taken, left]);
  const negative = isNegativeHours(left);
  const share = negative ? 1 : ratio(taken, total);
  return (
    <div className="bar-row">
      <div className="bar-head">
        <h3>{assignment.policyName}</h3>
        <Tag>{TYPE_LABELS[assignment.type]}</Tag>
      </div>
      <div
        className="bar"
        role="img"
        aria-label={`${hoursLabel(taken)} taken, ${hoursLabel(left)} left`}
      >
        <div className={negative ? "bar-fill bar-fill-over" : "bar-fill"} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <div className="bar-legend">
        <span>
          <strong>{withDays(taken, dayLength)}</strong> taken this year
        </span>
        <span className={negative ? "negative" : undefined}>
          <strong>{withDays(left, dayLength)}</strong> left
        </span>
      </div>
    </div>
  );
}

export function BalanceBars({ standings, dayLength }: { standings: Standing[]; dayLength: number | null }) {
  return (
    <div className="card bars">
      {standings.map((s) => (
        <Bar key={s.assignment.policyId} standing={s} dayLength={dayLength} />
      ))}
    </div>
  );
}
