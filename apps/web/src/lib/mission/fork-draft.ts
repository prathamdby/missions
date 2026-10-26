const KEY = "missions.fork-goal";

/** A goal waiting for the new-mission form, written by Fork from here. */
export const saveForkGoal = (goal: string): boolean => {
  try {
    sessionStorage.setItem(KEY, goal);
    return true;
  } catch {
    return false;
  }
};

/**
 * Reads and clears the saved goal so a refresh does not keep reapplying it.
 * A browser that blocks storage returns null, so the form still renders.
 */
export const takeForkGoal = (): string | null => {
  try {
    const goal = sessionStorage.getItem(KEY);
    if (goal === null) {
      return null;
    }
    sessionStorage.removeItem(KEY);
    return goal;
  } catch {
    return null;
  }
};
