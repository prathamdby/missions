const KEY = "missions.fork-goal";

/** A goal waiting for the new-mission form, written by Fork from here. */
export const saveForkGoal = (goal: string) => {
  sessionStorage.setItem(KEY, goal);
};

/** Reads and clears the saved goal so a refresh does not keep reapplying it. */
export const takeForkGoal = (): string | null => {
  const goal = sessionStorage.getItem(KEY);
  if (goal === null) {
    return null;
  }
  sessionStorage.removeItem(KEY);
  return goal;
};
