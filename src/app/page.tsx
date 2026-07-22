import styles from "./page.module.css";

const roles = [
  { title: "学生与家长", note: "夏令营班型、日期、费用与准备事项" },
  { title: "教师", note: "培训等级、时间安排、前置条件与费用" },
  { title: "机构与企业", note: "平台权益、企业培训与项目合作" },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>OPC 软件系统与智能体大赛 · 开发中</span>
        <h1>AI课程顾问 Agent</h1>
        <p>
          一个以官方资料为边界、推荐理由可解释、回答来源可追溯的课程咨询助手。
        </p>

        <div className={styles.status} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          TASK-01 基础环境已就绪，业务功能将在后续阶段接入
        </div>

        <div className={styles.roleGrid} aria-label="计划支持的服务对象">
          {roles.map((role) => (
            <article className={styles.roleCard} key={role.title}>
              <h2>{role.title}</h2>
              <p>{role.note}</p>
            </article>
          ))}
        </div>

        <aside className={styles.notice}>
          当前页面仅用于验证项目可运行，不代表课程咨询功能已经完成，也不会返回任何课程事实。
        </aside>
      </section>
    </main>
  );
}
