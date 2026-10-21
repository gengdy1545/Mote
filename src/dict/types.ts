export type DictSense = {
  pos: string;
  gloss: string;
  lang: "zh" | "en";
};

export type DictPhrase = {
  phrase: string;
  meaning: string;
};

export type DictExample = {
  sentence: string;
  translation: string;
};

export type DictWord = {
  spelling: string;
  phoneticUs: string;
  phoneticUk: string;
  audioUsPath: string;
  fetchedAt: string;
  glossAt: string;
  audioAt: string;
  senses: DictSense[];
  phrases: DictPhrase[];
  examples: DictExample[];
};

export function emptyDictWord(spelling: string, fetchedAt: string): DictWord {
  return {
    spelling,
    phoneticUs: "",
    phoneticUk: "",
    audioUsPath: "",
    fetchedAt,
    glossAt: "",
    audioAt: "",
    senses: [],
    phrases: [],
    examples: [],
  };
}

export function dictionaryKey(spelling: string): string {
  return spelling.trim().toLowerCase();
}
