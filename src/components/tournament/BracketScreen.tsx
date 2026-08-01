"use client";

import { HexBadge, HexPanel } from "@/components/Hex";
import { CrestMark } from "@/components/Crest";
import {
  buildCoachTeam,
  currentRound,
  isTournamentOver,
  swapPositions,
  COACH_TEAM_NAME,
  type TournamentState,
} from "@/lib/tournamentState";
import {
  formatTimeLimit,
  lineupPlayers,
  stylesFor,
  POSITIONS,
  TOURNAMENT_ROUNDS,
  type Position,
} from "@/lib/kendo";

/** Bracket path plus the lineup controls for the round about to be played. */
export function BracketScreen({
  state,
  onChange,
  onPlay,
  onReview,
}: {
  state: TournamentState;
  onChange: (next: TournamentState) => void;
  onPlay: () => void;
  onReview: (roundIndex: number) => void;
}) {
  const round = currentRound(state);
  const over = isTournamentOver(state);
  const lineup = over ? [] : lineupPlayers(buildCoachTeam(state));

  return (
    <section className="flex flex-col gap-4 sm:gap-10">
      <BracketPath state={state} onReview={onReview} />

      {over ? (
        <TournamentOutcome state={state} />
      ) : (
        <>
          <header className="flex flex-col items-center gap-0.5 text-center sm:gap-2">
            <p className="display text-[10px] text-brass-400 sm:text-xs">
              Vòng {round.index} / 4 · Thời gian mỗi trận {formatTimeLimit(round.timeLimitSeconds)}
            </p>
            <h2 className="display text-2xl text-bone sm:text-4xl">{round.label}</h2>
            <p className="hidden max-w-xl text-xs text-bone-dim sm:block sm:text-sm">
              Xem trước năm đối thủ rồi sắp xếp đội hình của bạn. Họ chỉ chọn vị
              trí sau khi bạn đã chốt.
            </p>
          </header>

          <OpponentPreview state={state} />
          <LineupEditor state={state} onChange={onChange} />

          <div className="flex flex-col items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onPlay}
              className="hex-tab bg-brass-400 px-10 py-2.5 text-forest-900 transition-colors hover:bg-brass-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-200 sm:px-12 sm:py-4"
            >
              <span className="display text-sm sm:text-base">Bắt đầu trận đấu</span>
            </button>
            <p className="hidden text-xs text-bone-faint sm:block">
              {lineup.length === POSITIONS.length
                ? "Đội hình đã đủ năm vị trí."
                : "Đội hình chưa hợp lệ."}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function BracketPath({
  state,
  onReview,
}: {
  state: TournamentState;
  onReview: (roundIndex: number) => void;
}) {
  return (
    <ol className="flex items-start justify-center gap-1.5 sm:gap-6">
      {TOURNAMENT_ROUNDS.map((round, i) => {
        const outcome = state.results[i];
        const isCurrent = !isTournamentOver(state) && i === state.roundIndex;
        const won = outcome?.match.result.winner === "A";
        const state_ = outcome ? "done" : isCurrent ? "active" : "idle";

        return (
          <li
            key={round.name}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:w-40 sm:max-w-40 sm:flex-none sm:gap-2"
          >
            <HexBadge state={state_} className="h-10 w-9 sm:h-16 sm:w-14">
              <span className="display text-xs sm:text-base">{round.index}</span>
            </HexBadge>
            <span
              className={`display text-center text-[10px] sm:text-xs ${
                isCurrent ? "text-brass-300" : outcome ? "text-bone-dim" : "text-bone-faint"
              }`}
            >
              {round.label}
            </span>
            {outcome ? (
              <button
                type="button"
                onClick={() => onReview(i)}
                className={`text-center text-[11px] leading-tight underline underline-offset-2 transition-colors hover:text-brass-300 ${
                  won ? "text-brass-300" : "text-blood"
                }`}
              >
                {won ? "Thắng" : "Thua"} {outcome.match.result.teamAWins}-
                {outcome.match.result.teamBWins}
                <br />
                <span className="text-bone-faint">Xem lại</span>
              </button>
            ) : (
              <span className="text-center text-[11px] text-bone-faint">
                {formatTimeLimit(round.timeLimitSeconds)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The five the coach is about to face, revealed before they set positions.
 * Names only — the same hidden-stats principle as the draft — and shown
 * unordered, because the opposition has not chosen its positions yet.
 */
function OpponentPreview({ state }: { state: TournamentState }) {
  const opponents = state.pendingOpponent;
  if (!opponents) return null;

  return (
    <section className="flex flex-col items-center gap-1.5 sm:gap-3">
      <h3 className="display text-xs text-blood sm:text-sm">
        Đối thủ: {opponents.team.name}
      </h3>
      <ul className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
        {opponents.players.map((player) => (
          <li key={player.id}>
            <HexPanel cut={10} frameClassName="bg-blood/40" bodyClassName="bg-forest-900">
              <div className="px-2.5 py-1 sm:px-4 sm:py-2">
                <span className="text-[11px] text-bone-dim sm:text-sm">{player.name}</span>
              </div>
            </HexPanel>
          </li>
        ))}
      </ul>
      <p className="text-center text-[11px] text-bone-faint sm:text-xs">
        Chưa rõ ai đánh vị trí nào — họ sẽ xếp sau khi bạn chốt đội hình.
      </p>
    </section>
  );
}

function LineupEditor({
  state,
  onChange,
}: {
  state: TournamentState;
  onChange: (next: TournamentState) => void;
}) {
  const byId = new Map(state.squad.map((p) => [p.id, p]));

  const move = (position: Position, direction: -1 | 1) => {
    const i = POSITIONS.indexOf(position);
    const j = i + direction;
    if (j < 0 || j >= POSITIONS.length) return;
    onChange({
      ...state,
      assignment: swapPositions(state.assignment, position, POSITIONS[j]),
    });
  };

  return (
    // Two across on phone: these cards are narrow enough, and five stacked
    // singles pushed the start button well below the fold.
    <ol className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
      {POSITIONS.map((position, i) => {
        const person = byId.get(state.assignment[position])!;
        const styles = stylesFor(person);

        return (
          <li key={position}>
            <HexPanel className="h-full" cut={14}>
              <div className="flex h-full flex-col items-center gap-1.5 px-2 py-2.5 text-center sm:gap-3 sm:px-4 sm:py-6">
                <span className="display text-[10px] text-brass-400 sm:text-xs">
                  {i + 1} · {position}
                </span>
                <span className="display flex-1 text-xs leading-tight text-bone sm:text-base">
                  {person.name}
                </span>

                {/* Stance is rolled at the start of each bout, not chosen
                    here — this only shows what they are capable of. */}
                <span className="text-[10px] text-bone-faint sm:text-[11px]">
                  {styles.length > 1 ? styles.join(" / ") : styles[0]}
                </span>

                <div className="flex gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => move(position, -1)}
                    disabled={i === 0}
                    aria-label={`Chuyển ${person.name} lên vị trí trước`}
                    className="display bg-forest-700 px-2.5 py-0.5 text-xs text-brass-300 transition-colors hover:bg-forest-600 disabled:cursor-not-allowed disabled:bg-forest-800 disabled:text-bone-faint sm:px-3 sm:py-1"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(position, 1)}
                    disabled={i === POSITIONS.length - 1}
                    aria-label={`Chuyển ${person.name} xuống vị trí sau`}
                    className="display bg-forest-700 px-2.5 py-0.5 text-xs text-brass-300 transition-colors hover:bg-forest-600 disabled:cursor-not-allowed disabled:bg-forest-800 disabled:text-bone-faint sm:px-3 sm:py-1"
                  >
                    →
                  </button>
                </div>
              </div>
            </HexPanel>
          </li>
        );
      })}
    </ol>
  );
}

function TournamentOutcome({ state }: { state: TournamentState }) {
  const champion = state.champion === true;
  const lost = state.results[state.results.length - 1];

  return (
    <div className="pine-watermark flex flex-col items-center gap-6 text-center">
      <CrestMark className="h-20 w-auto" />
      <h2 className={`display text-4xl ${champion ? "text-brass-300" : "text-blood"}`}>
        {champion ? "Vô địch" : `Dừng bước ở ${lost?.round.label}`}
      </h2>
      <p className="max-w-lg text-sm text-bone-dim">
        {champion
          ? `${COACH_TEAM_NAME} đi trọn bốn vòng và nâng cúp.`
          : `${COACH_TEAM_NAME} thua ${lost?.opponentTeam.name} với tỉ số ${lost?.match.result.teamAWins}-${lost?.match.result.teamBWins}.`}
      </p>
    </div>
  );
}
