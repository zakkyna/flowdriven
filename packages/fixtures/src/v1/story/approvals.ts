import { type Approval, approvalExpiresAt } from "@flowdriven/contracts/v1";

const emailFlow = "dev.example.email-triage";
export function approvals(): Approval[] {
  function send(
    id: string,
    name: string,
    address: string,
    subject: string,
    summary: string,
    time: string,
  ): Approval {
    const createdAt = `2026-11-10T${time}:00.000Z`;
    return {
      id,
      kind: "risky_action",
      riskyAction: "send",
      flowId: emailFlow,
      flowName: "Email triage and draft replies",
      runId: "run-0007",
      stepId: "send-approved",
      stepTitle: "Send approved drafts",
      summary,
      payload: {
        kind: "email",
        to: [`${name} <${address}>`],
        subject,
        body: `Hi ${name.split(" ")[0]},\n\nThank you for your message. I will follow up shortly.`,
      },
      editable: true,
      similarGroup: "run-0007:send",
      createdAt,
      expiresAt: approvalExpiresAt(createdAt),
      state: "pending",
    };
  }
  function result(
    id: string,
    runId: string,
    createdAt: string,
    state: "approved" | "rejected",
    resolvedAt: string,
  ): Approval {
    return {
      id,
      kind: "result_sign_off",
      flowId: "dev.example.documents-and-reports",
      flowName: "Documents and reports",
      runId,
      stepId: "final-approval",
      stepTitle: "Approve the final report",
      summary: "Approve the final report",
      payload: { kind: "text", text: "Review the completed report." },
      editable: false,
      createdAt,
      expiresAt: approvalExpiresAt(createdAt),
      state,
      resolvedAt,
    };
  }
  const createdAt = "2026-11-10T09:20:00.000Z";
  const postAt = "2026-11-09T16:20:00.000Z";
  return [
    {
      id: "ap-0015",
      kind: "flow_sign_off",
      flowId: "dev.example.lead-follow-up",
      flowName: "Lead follow-up",
      summary: "Approve the changes to Lead follow-up (version 1.3.0)",
      payload: {
        kind: "diff",
        files: [
          {
            path: "flow.yaml",
            patch: "-version: 1.2.0\n+version: 1.3.0\n+  Review each follow-up before sending.",
          },
        ],
      },
      editable: false,
      createdAt,
      expiresAt: approvalExpiresAt(createdAt),
      state: "pending",
    },
    send(
      "ap-0013",
      "Mei Chen",
      "mei@example.com",
      "Re: Thursday meeting",
      "Send a reply to Mei Chen about the meeting time",
      "09:07",
    ),
    send(
      "ap-0012",
      "Tomás Ruiz",
      "tomas@example.com",
      "Re: Delivery date",
      "Send a reply to Tomás Ruiz about the delivery date",
      "09:06",
    ),
    send(
      "ap-0011",
      "Priya Shah",
      "priya@example.com",
      "Re: Invoice 1042",
      "Send a reply to Priya Shah about invoice 1042",
      "09:05",
    ),
    {
      id: "ap-0014",
      kind: "risky_action",
      riskyAction: "post",
      flowId: "dev.example.social-posts",
      flowName: "One source into many social posts",
      runId: "run-0004",
      stepId: "publish",
      stepTitle: "Publish",
      summary: "Publish the launch post to Instagram",
      payload: {
        kind: "post",
        platform: "Instagram",
        text: "Our launch is here. Discover what is new.",
        media: ["media/launch-cover.png"],
      },
      editable: true,
      createdAt: postAt,
      expiresAt: approvalExpiresAt(postAt),
      state: "pending",
    },
    result("ap-0010", "run-0005", "2026-11-10T08:10:00.000Z", "approved", "2026-11-10T08:11:00.000Z"),
    result("ap-0009", "run-0001", "2026-11-07T10:20:00.000Z", "rejected", "2026-11-07T10:30:00.000Z"),
  ];
}
