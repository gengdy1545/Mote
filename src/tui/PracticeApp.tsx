import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import type { DictWord } from "../dict/types.js";
import type { PracticeState } from "../study/practice.js";
import { practiceText } from "../study/text.js";

export type PracticeController = {
  initial: PracticeState;
  offline: boolean;
  words: Record<string, DictWord | null>;
  reveal: () => PracticeState | Promise<PracticeState>;
  replay: () => void | Promise<void>;
  move: (delta: -1 | 1) => PracticeState | Promise<PracticeState>;
  jump: (position: number) => PracticeState | Promise<PracticeState>;
  hide: () => PracticeState;
  quit: () => PracticeState;
  availability: () => { gloss: boolean; audio: boolean };
  errors: () => string[];
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
  const [errors, setErrors] = useState(() => controller.errors());
  const closed = useRef(false);
  const leave = () => {
    if (closed.current) return;
    closed.current = true;
    controller.quit();
    exit();
  };

  useEffect(() => {
    if (columns) return;
    const onResize = () => setTermColumns(terminal.columns || 80);
    terminal.on("resize", onResize);
    return () => {
      terminal.off("resize", onResize);
    };
  }, [terminal, columns]);

  useEffect(() => {
    const sync = () => {
      setReady(controller.availability());
      setErrors(controller.errors());
    };
    sync();
    return controller.watch(sync);
  }, [controller, state.index]);

  useInput(async (input, key) => {
    if (closed.current) return;
    if (jumpRef.current !== null) {
      if (input === "q") {
        leave();
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
        if (closed.current) return;
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
      if (closed.current) return;
      setState(next);
      return;
    }
    if (input === " ") {
      if (!controller.availability().gloss) return;
      if (stateRef.current.revealed) {
        setState(controller.hide());
        return;
      }
      const next = await Promise.resolve(controller.reveal());
      if (closed.current) return;
      setState(next);
      return;
    }
    if (input === "p") {
      if (!controller.availability().audio) return;
      await Promise.resolve(controller.replay());
      return;
    }
    if (input === "q") leave();
  });

  const text = practiceText({
    state,
    offline: controller.offline,
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
      {errors.map((line) => (
        <Text key={line} color="red">
          {line}
        </Text>
      ))}
    </Box>
  );
}
