import { DispatchHeader } from "./_components/header";
import { currentDepot } from "./depot";

export default async function ControlTowerPage() {
  const depot = await currentDepot();
  return (
    <>
      <DispatchHeader title="Control tower" context={`${depot} · placeholder`} depot={depot} />
      <main className="p-6 text-muted-foreground">D-01 is built in the next step.</main>
    </>
  );
}
