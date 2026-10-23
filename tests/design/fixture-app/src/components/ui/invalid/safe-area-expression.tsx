// expect: missions-design/no-off-scale-spacing
export const InvalidSafeArea = () => (
  <div className="mb-[max(env(safe-area-inset-bottom),var(--spacing-lg))] pt-[max(env(safe-area-inset-bottom),var(--spacing-xs))] pb-[calc(env(safe-area-inset-bottom)+var(--spacing-lg))] pb-[max(env(safe-area-inset-bottom),var(--color-text))]">
    Only matching-edge padding with a named spacing floor is permitted
  </div>
);
