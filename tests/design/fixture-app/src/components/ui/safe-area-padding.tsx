export const SafeAreaPadding = () => (
  <div className="pt-[max(env(safe-area-inset-top),var(--spacing-xs))] pr-[max(env(safe-area-inset-right),var(--spacing-md))] pb-[max(env(safe-area-inset-bottom),var(--spacing-lg))] pl-[max(env(safe-area-inset-left),var(--spacing-md))] md:pb-[max(env(safe-area-inset-bottom),var(--spacing-drawer-bottom))]">
    Safe-area padding with named floors
  </div>
);
