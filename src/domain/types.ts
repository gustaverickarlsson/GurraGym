export type SetEntry = {
  weight: string;
  reps: string;
  notes: string;
};

export type ExerciseLog = {
  exerciseId: string;
  name: string;
  sets: SetEntry[];
};

export type WorkoutLog = {
  id: string;
  phaseId: string;
  week: number;
  day: string;
  date: string;
  gym: string;
  exercises: ExerciseLog[];
};

export type DayProgram = {
  name: string;
  exercises: Array<{
    id: string;
    name: string;
    scheme: string;
    numSets: number;
    notes?: string;
  }>;
};

export type Phase = {
  id: string;
  name: string;
  weeks: number[];
  days: DayProgram[];
};

export type GurraGymData = {
  phases: Phase[];
  logs: WorkoutLog[];
  gyms: string[];
  lastModified?: string;
  _exported?: string;
};
