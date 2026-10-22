// expect: shadcn/require-static-classes
import { Button } from "@/components/ui/button";

export const Dynamic = ({ tone }: { tone: string }) => (
  <Button className={`bg-${tone}`}>Save</Button>
);
