import { Box, Text, useApp, useInput } from "ink";

export function LookupApp({
  text,
  hint,
  onPlay,
  onQuit,
}: {
  text: string;
  hint: string;
  onPlay: () => void;
  onQuit: () => void;
}) {
  const { exit } = useApp();
  useInput((input) => {
    if (input === "q") {
      onQuit();
      exit();
      return;
    }
    if (input === "p") onPlay();
  });
  return (
    <Box flexDirection="column">
      {text.split("\n").map((line, index) => (
        <Text key={index}>{line.length > 0 ? line : " "}</Text>
      ))}
      <Text>{hint}</Text>
    </Box>
  );
}
