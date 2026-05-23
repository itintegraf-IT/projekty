"use client";

type Props = {
  machines: readonly string[];
  activeMachine: string;
  ownMachine: string;
  onChange: (machine: string) => void;
};

export function TiskarMachineToggle({ machines, activeMachine, ownMachine, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Volba stroje"
      style={{
        display: "inline-flex",
        background: "rgba(118,118,128,0.12)",
        borderRadius: 9,
        padding: 2,
        gap: 2,
      }}
    >
      {machines.map((m) => {
        const isActive = m === activeMachine;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={isActive}
            onClick={(e) => {
              if (e.button !== 0) return;
              onChange(m);
            }}
            style={{
              all: "unset",
              padding: "4px 14px",
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              borderRadius: 7,
              background: isActive ? "white" : "transparent",
              boxShadow: isActive
                ? "0 2px 6px rgba(0,0,0,0.08), 0 1px 1px rgba(0,0,0,0.05)"
                : "none",
              color: "var(--text)",
              cursor: "pointer",
              transition: "all 150ms ease",
              whiteSpace: "nowrap",
            }}
            title={m === ownMachine ? `${m} (můj stroj)` : `${m} — peek`}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}
