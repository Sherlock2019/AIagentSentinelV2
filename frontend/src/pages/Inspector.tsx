import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { DecisionBadge } from "../components/badges";
import { EventInspectorView } from "../components/EventInspectorView";
import { Card, Empty, ErrorState, Loading, PageHeader, Segmented, callText, cx, formatTime } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import type { EventDetail } from "../types";

export default function Inspector() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"" | "BLOCK" | "REVIEW" | "ALLOW">("");
  const events = usePolling(() => api.events({ kind: "ACTION", decision: filter, limit: 60 }), 4000, [filter]);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // With no event chosen, open the most interesting one: the latest block, else the latest event.
  useEffect(() => {
    if (eventId || !events.data?.length) return;
    const pick = events.data.find((e) => e.decision === "BLOCK") || events.data[0];
    navigate(`/inspector/${pick.id}`, { replace: true });
  }, [eventId, events.data, navigate]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setError(null);
    api.event(eventId).then((d) => !cancelled && setDetail(d)).catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [eventId]);

  return (
    <>
      <PageHeader title="Event Inspector" subtitle="What the agent was supposed to do, what it tried to do, what every engine found, and what Sentinel did." />
      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <Card className="h-fit overflow-hidden lg:sticky lg:top-0">
          <div className="border-b border-slate-100 px-3 py-2.5">
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "", label: "All" }, { value: "BLOCK", label: "Block" }, { value: "REVIEW", label: "Review" }, { value: "ALLOW", label: "Allow" }]} />
          </div>
          <ul className="scroll-thin max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {(events.data || []).map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/inspector/${event.id}`)}
                  className={cx("block w-full px-3 py-2.5 text-left hover:bg-slate-50", event.id === eventId && "bg-blue-50 hover:bg-blue-50")}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-600">{event.agent_name}</span>
                    <DecisionBadge decision={event.decision} />
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-slate-800">{callText(event.tool, event.resource)}</span>
                  <span className="font-mono text-[10px] text-slate-400">{formatTime(event.timestamp)}</span>
                </button>
              </li>
            ))}
            {events.data?.length === 0 && <li><Empty title="No events" /></li>}
          </ul>
        </Card>
        <div className="min-w-0">
          {error ? <ErrorState message={error} /> : !eventId ? (
            events.data?.length === 0 ? <Card><Empty icon={<Search className="h-8 w-8" />} title="Nothing to inspect yet" hint="Run a scenario in the Red Team Lab." /></Card> : <Loading />
          ) : !detail || detail.id !== eventId ? <Loading /> : <EventInspectorView event={detail} />}
        </div>
      </div>
    </>
  );
}
