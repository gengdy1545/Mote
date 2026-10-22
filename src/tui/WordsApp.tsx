import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import { formatWordPage } from "../study/words.js";

export function WordsApp({ words, pageSize }: { words: readonly string[]; pageSize: number }) {
  const { exit } = useApp();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(words.length / pageSize));
  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (key.leftArrow) setPage((current) => Math.max(0, current - 1));
    if (key.rightArrow) setPage((current) => Math.min(pages - 1, current + 1));
  });
  const text = formatWordPage(words, page, pageSize);
  return (
    <Box flexDirection="column">
      {text.split("\n").map((line, index) => (
        <Text key={index}>{line.length > 0 ? line : " "}</Text>
      ))}
    </Box>
  );
}
