import CourseAdvisor from "@/components/CourseAdvisor";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ test?: string | string[] }>;
}) {
  const params = await searchParams;
  return <CourseAdvisor testMode={params.test === "1"} />;
}
