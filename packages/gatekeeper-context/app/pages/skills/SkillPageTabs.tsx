import { Badge, Button } from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import { XIcon } from "@phosphor-icons/react";
import { useRef, type KeyboardEvent } from "react";

export type SkillPageTab = {
  value: string;
  label: string;
  badge?: number;
  closable?: boolean;
};

export const skillTabId = (value: string): string => `skill-tab-${value}`;
export const skillPanelId = (value: string): string => `skill-panel-${value}`;

export const SkillPageTabs = ({
  tabs,
  value,
  onValueChange,
  onClose,
}: {
  tabs: SkillPageTab[];
  value: string;
  onValueChange: (value: string) => void;
  onClose: (value: string) => void;
}) => {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectAndFocus = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onValueChange(tab.value);
    window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
  };

  const closeAndRestoreFocus = (index: number, tab: SkillPageTab) => {
    onClose(tab.value);
    const fallbackIndex = Math.max(0, index - 1);
    window.requestAnimationFrame(() => tabRefs.current[fallbackIndex]?.focus());
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    tab: SkillPageTab,
  ) => {
    if ((event.key === "Delete" || event.key === "Backspace") && tab.closable) {
      event.preventDefault();
      closeAndRestoreFocus(index, tab);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectAndFocus(nextIndex);
  };

  return (
    <div
      role="tablist"
      aria-label="Skill views"
      aria-orientation="horizontal"
      className="flex flex-wrap items-center gap-1"
    >
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        return (
          <div
            key={tab.value}
            role="presentation"
            className={cn(
              "flex items-center rounded-lg *:text-sm!",
              active ? "bg-kumo-recessed" : "hover:bg-kumo-tint",
            )}
          >
            <Button
              type="button"
              role="tab"
              variant="ghost"
              size="base"
              id={skillTabId(tab.value)}
              aria-controls={skillPanelId(tab.value)}
              aria-selected={active}
              tabIndex={0}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              onClick={() => onValueChange(tab.value)}
              onKeyDown={(event) => handleKeyDown(event, index, tab)}
              className={cn(
                "bg-transparent! text-kumo-subtle outline-none! hover:bg-transparent! hover:text-kumo-default focus-visible:ring-1! focus-visible:ring-kumo-focus!",
                tab.closable ? "rounded-l-lg rounded-r-none" : "rounded-lg",
                active && "text-kumo-default",
                tab.closable && "pr-1!",
              )}
            >
              <span className="max-w-56 truncate">{tab.label}</span>
              {tab.badge !== undefined && <Badge variant="secondary">{tab.badge}</Badge>}
            </Button>
            {tab.closable && (
              <Button
                type="button"
                variant="ghost"
                size="base"
                shape="square"
                aria-label={`Close ${tab.label}`}
                tabIndex={0}
                onClick={() => closeAndRestoreFocus(index, tab)}
                className="w-7! pr-1.5 rounded-l-none rounded-r-lg bg-transparent! text-kumo-subtle opacity-50 outline-none! hover:bg-transparent! hover:text-kumo-default hover:opacity-100 focus-visible:text-kumo-default focus-visible:ring-1! focus-visible:ring-kumo-focus!"
              >
                <XIcon aria-hidden="true" size={12} weight="bold" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
};
