"use client";

import { useState } from "react";
import { DraftScreen } from "./draft/DraftScreen";
import { BracketScreen } from "./tournament/BracketScreen";
import { MatchViewer } from "./tournament/MatchViewer";
import { CLUB_ROSTER } from "@/data/club";
import {
  beginRound,
  createTournament,
  playCurrentRound,
  type TournamentState,
} from "@/lib/tournamentState";
import type { PersonRecord } from "@/lib/kendo";

type Phase =
  | { screen: "draft" }
  | { screen: "bracket" }
  | { screen: "match"; roundIndex: number; replay: boolean };

/** Owns the whole run: draft once, then four rounds of bracket → match. */
export function GameShell() {
  const [tournament, setTournament] = useState<TournamentState | null>(null);
  const [phase, setPhase] = useState<Phase>({ screen: "draft" });

  const startTournament = (squad: PersonRecord[]) => {
    // Draw the first opponents straight away: the coach must see who they are
    // facing before they set positions.
    setTournament(beginRound(createTournament(squad), CLUB_ROSTER));
    setPhase({ screen: "bracket" });
  };

  const playRound = () => {
    if (!tournament) return;
    const next = playCurrentRound(tournament);
    setTournament(next);
    setPhase({ screen: "match", roundIndex: next.results.length - 1, replay: false });
  };

  /** Returning to the bracket draws the next round's opposition. */
  const backToBracket = () => {
    setTournament((current) => (current ? beginRound(current, CLUB_ROSTER) : current));
    setPhase({ screen: "bracket" });
  };

  const restart = () => {
    setTournament(null);
    setPhase({ screen: "draft" });
  };

  if (!tournament || phase.screen === "draft") {
    return <DraftScreen onStart={startTournament} />;
  }

  if (phase.screen === "match") {
    const outcome = tournament.results[phase.roundIndex];
    if (!outcome) {
      setPhase({ screen: "bracket" });
      return null;
    }
    return (
      <MatchViewer
        outcome={outcome}
        replay={phase.replay}
        onDone={backToBracket}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-10">
      <BracketScreen
        state={tournament}
        onChange={setTournament}
        onPlay={playRound}
        onReview={(roundIndex) => setPhase({ screen: "match", roundIndex, replay: true })}
      />
      <div className="flex justify-center">
        <button
          type="button"
          onClick={restart}
          className="display text-xs text-bone-faint underline underline-offset-4 transition-colors hover:text-brass-600"
        >
          Chơi lại từ đầu
        </button>
      </div>
    </div>
  );
}
