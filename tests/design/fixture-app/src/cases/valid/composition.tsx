import { Button } from "@/components/ui/button";

export const Composition = () => (
  <section className="flex max-w-chat flex-col gap-sm rounded-md bg-surface p-lg shadow-sm md:p-xl">
    <h2 className="type-heading text-text">Mission</h2>
    <p className="type-body text-text-secondary">
      Every class here resolves to a Paper token.
    </p>
    <div className="-mt-xs flex items-center gap-md">
      <span className="size-4 rounded-full bg-success" />
      <span className="type-micro text-text-tertiary">3 agents running</span>
    </div>
    <div className="sticky top-0 z-sticky w-sidebar bg-background text-foreground">
      <Button className="mt-lg w-full" size="sm" variant="primary">
        Approve plan
      </Button>
    </div>
  </section>
);
