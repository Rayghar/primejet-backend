import React from "react";
import Badge from "../shared/Badge";

const norm = (s) => String(s || "UNPOSTED").toUpperCase();

export default function PostingStatusBadge({ status, className = "" }) {
  const v = norm(status);
  const tone =
    v === "POSTED"
      ? "good"
      : v === "FAILED"
      ? "bad"
      : v === "QUEUED"
      ? "info"
      : v === "SKIPPED"
      ? "warn"
      : "neutral";

  return <Badge tone={tone} className={className}>{v}</Badge>;
}
