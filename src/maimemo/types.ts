export type Progress = {
  finished: number;
  total: number;
  studyTime: number;
};

export type TodayItem = {
  vocId: string;
  spelling: string;
  order: number;
  isNew: boolean;
  isFinished: boolean;
  firstResponse?: string;
};

export type Interpretation = {
  id: string;
  text: string;
  tags: string[];
  status: string;
};

export type Vocabulary = {
  id: string;
  spelling: string;
};
