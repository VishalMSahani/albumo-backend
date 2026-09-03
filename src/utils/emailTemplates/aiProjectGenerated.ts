import { wrapTemplate, type EmailTemplate } from "./base.js";

export function aiProjectGeneratedTemplate(data: {
  project: {
    projectId: string;
    title: string;
    description: string;
    difficulty: string;
    estimatedTime?: string;
    componentsNeeded?: string[];
  };
  user?: {
    name: string;
  };
}): EmailTemplate {
  const componentsHtml = data.project.componentsNeeded
    ? `
    <h2>Components Needed</h2>
    <ul>
      ${data.project.componentsNeeded.map((component) => `<li>${component}</li>`).join("")}
    </ul>
  `
    : "";

  const content = `
    <h1>Your AI Project is Ready! 🤖</h1>
    <p>Hi ${data.user?.name || "there"},</p>
    <p>
      Great news! Our AI has generated a personalized hardware project just for you.
      This project is tailored to your skill level and interests.
    </p>

    <div class="info-box">
      <h2 style="margin-top: 0;">${data.project.title}</h2>
      <p><strong>Difficulty:</strong> ${data.project.difficulty}</p>
      ${data.project.estimatedTime ? `<p><strong>Estimated Time:</strong> ${data.project.estimatedTime}</p>` : ""}
      <p style="margin-top: 15px;">${data.project.description}</p>
    </div>

    ${componentsHtml}

    <p class="text-center">
      <a href="https://roboroot.in/projects/${data.project.projectId}" class="button">View Full Project Details</a>
    </p>

    <h2>What's Next?</h2>
    <ul>
      <li>📖 <strong>Review the project:</strong> Read through the detailed instructions and circuit diagrams</li>
      <li>🛒 <strong>Get components:</strong> Order everything you need from our component store</li>
      <li>🔧 <strong>Start building:</strong> Follow the step-by-step guide</li>
      <li>👨‍🏫 <strong>Need help?</strong> Book a mentor session for guidance</li>
    </ul>

    <p>
      <strong>Pro Tip:</strong> Save this project to your profile so you can access it anytime!
    </p>

    <p class="text-center">
      <a href="https://roboroot.in/projects/${data.project.projectId}/components">Shop Components</a> | 
      <a href="https://roboroot.in/mentors">Find a Mentor</a>
    </p>

    <p>
      Questions about the project? Contact us at 
      <a href="mailto:projects@roboroot.in">projects@roboroot.in</a>
    </p>

    <p>
      Happy Building! 🔧⚡<br>
      The RoboRoot Team
    </p>
  `;

  return {
    subject: `Your AI-Generated Project: ${data.project.title}`,
    html: wrapTemplate(content),
    text: `Your AI Project is Ready! 🤖

Hi ${data.user?.name || "there"},

Great news! Our AI has generated a personalized hardware project just for you. This project is tailored to your skill level and interests.

${data.project.title}
Difficulty: ${data.project.difficulty}
${data.project.estimatedTime ? `Estimated Time: ${data.project.estimatedTime}` : ""}

${data.project.description}

${
  data.project.componentsNeeded
    ? `Components Needed:
${data.project.componentsNeeded.map((c) => `• ${c}`).join("\n")}`
    : ""
}

View full project: https://roboroot.in/projects/${data.project.projectId}

What's Next?
📖 Review the project details and instructions
🛒 Get components from our store
🔧 Start building following the guide
👨‍🏫 Book a mentor session if you need help

Shop Components: https://roboroot.in/projects/${data.project.projectId}/components
Find a Mentor: https://roboroot.in/mentors

Questions? Contact us at projects@roboroot.in

Happy Building! 🔧⚡
The RoboRoot Team`,
  };
}
