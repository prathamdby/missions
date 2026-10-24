// expect: missions-design/no-feature-tabindex
export const Invalid = () => (
  <button tabIndex={-1} type="button">
    Hidden stop
  </button>
);
