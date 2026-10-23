// expect: missions-design/no-off-scale-spacing
export const RawPadding = () => (
  <div className="px-[5px] px-[40px] py-[3px] pt-[max(env(safe-area-inset-top),4px)] pb-[max(env(safe-area-inset-bottom),12px)] pb-[max(env(safe-area-inset-bottom),21px)]">
    Raw padding is never a primitive exception
  </div>
);
