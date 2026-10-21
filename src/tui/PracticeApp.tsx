import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import type { DictWord } from "../dict/types.js";
import type { Interpretation } from "../maimemo/types.js";
import type { PracticeState } from "../study/practice.js";
import { practiceText } from "../study/text.js";

export type PracticeController = {
  initial: PracticeState;
  offline: boolean;
  content: Record<string, Interpretation[]>;
  words: Record<string, DictWord | null>;
  reveal: () => PracticeState | Promise<PracticeState>;
  replay: () => void | Promise<void>;
  move: (delta: -1 | 1) => PracticeState | Promise<PracticeState>;
  jump: (position: number) => PracticeState | Promise<PracticeState>;
  hide: () => PracticeState;
  quit: () => PracticeState;
  availability: () => { gloss: boolean; audio: boolean };
  watch: (notify: () => void) => () => void;
};

export function PracticeApp({ controller, columns }: { controller: PracticeController; columns?: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminal = stdout as { columns?: number; on: (event: "resize", listener: () => void) => void; off: (event: "resize", listener: () => void) => void };
  const [state, setState] = useState(controller.initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [termColumns, setTermColumns] = useState(terminal.columns || 80);
  const width = columns ?? termColumns;
  const [jumpDraft, setJumpDraft] = useState<string | null>(null);
  const jumpRef = useRef(jumpDraft);
  jumpRef.current = jumpDraft;
  const [ready, setReady] = useState(() => controller.availability());

  useEffect(() => {
    if (columns) return;
    const onResize = () => setTermColumns(terminal.columns || 80);
    terminal.on("resize", onResize);
    return () => {
      terminal.off("resize", onResize);
    };
  }, [terminal, columns]);

  useEffect(() => {
    setReady(controller.availability());
    return controller.watch(() => setReady(controller.availability()));
  }, [controller, state.index]);

  useInput(async (input, key) => {
    if (stateRef.current.status !== "practicing") return;
    if (jumpRef.current !== null) {
      if (input === "q") {
        controller.quit();
        exit();
        return;
      }
      if (key.escape) {
        setJumpDraft(null);
        return;
      }
      if (key.return) {
        const draft = jumpRef.current;
        setJumpDraft(null);
        if (!draft) return;
        const next = await Promise.resolve(controller.jump(Number(draft)));
        if (next.status !== "practicing") {
          exit();
          return;
        }
        setState(next);
        return;
      }
      if (key.backspace) {
        setJumpDraft(jumpRef.current.slice(0, -1));
        return;
      }
      if (/^\d$/.test(input) && jumpRef.current.length < 4) setJumpDraft(jumpRef.current + input);
      return;
    }
    if (input === "g") {
      setJumpDraft("");
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      const next = await Promise.resolve(controller.move(key.leftArrow ? -1 : 1));
      if (next.status !== "practicing") {
        exit();
        return;
      }
      setState(next);
      return;
    }
    if (input === " ") {
      if (!controller.availability().gloss) return;
      if (stateRef.current.revealed) {
        setState(controller.hide());
        return;
      }
      setState(await Promise.resolve(controller.reveal()));
      return;
    }
    if (input === "p") {
      if (!controller.availability().audio) return;
      await Promise.resolve(controller.replay());
      return;
    }
    if (input === "q") {
      controller.quit();
      exit();
    }
  });

  const text = practiceText({
    state,
    offline: controller.offline,
    content: controller.content,
    words: controller.words,
    columns: width,
  });
  const position = `${state.index + 1}/${state.cards.length}`;

  return (
    <Box flexDirection="column">
      {text.split("\n").map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line.length > 0 ? line : " "}
        </Text>
      ))}
      {jumpDraft != null ? (
        <Text>{`${position}    跳转到 ${jumpDraft}    Enter 确认    Esc 取消`}</Text>
      ) : (
        <Box>
          <Text>{`${position}    ← → 切词    g 跳转    `}</Text>
          <Text dimColor={!ready.gloss}>Space 释义</Text>
          <Text>{"    "}</Text>
          <Text dimColor={!ready.audio}>p 发音</Text>
          <Text>{"    q 退出"}</Text>
        </Box>
      )}
    </Box>
  );
}
