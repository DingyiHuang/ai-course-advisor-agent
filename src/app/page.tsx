import CourseAdvisor from "@/components/CourseAdvisor";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    test?: string | string[];
    evidence?: string | string[];
    viewportDebug?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const viewportDebugAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview";
  return (
    <CourseAdvisor
      testMode={params.test === "1"}
      evidenceMode={params.evidence === "1"}
      viewportDebug={viewportDebugAllowed && params.viewportDebug === "1"}
    />
  );
}
