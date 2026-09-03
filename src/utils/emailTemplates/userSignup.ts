import { wrapTemplate, type EmailTemplate } from "./base.js";

export function userSignupTemplate(data: {
  user: {
    name: string;
    email: string;
  };
}): EmailTemplate {
  const content = `
    <h1>Welcome to RoboRoot! 🎉</h1>
    <p>Hi ${data.user.name || "there"},</p>
    <p>
      We're excited to have you on board! RoboRoot is your gateway to mastering hardware projects
      and bringing your innovative ideas to life.
    </p>
    
    <div class="info-box">
      <h2>What's Next?</h2>
      <ul>
        <li><strong>Explore Projects:</strong> Browse our extensive library of hardware projects</li>
        <li><strong>AI Project Generator:</strong> Get custom project ideas tailored to your skills</li>
        <li><strong>Shop Components:</strong> Find all the parts you need in our component store</li>
        <li><strong>Get Mentorship:</strong> Book sessions with experienced mentors</li>
      </ul>
    </div>

    <p class="text-center">
      <a href="https://roboroot.in/dashboard" class="button">Go to Dashboard</a>
    </p>

    <p>
      Need help getting started? Check out our 
      <a href="https://roboroot.in/getting-started">Getting Started Guide</a> 
      or reach out to our support team.
    </p>

    <p>
      Happy Building! 🔧⚡<br>
      The RoboRoot Team
    </p>
  `;

  return {
    subject: "Welcome to RoboRoot - Let's Start Building! 🚀",
    html: wrapTemplate(content),
    text: `Welcome to RoboRoot! 🎉

Hi ${data.user.name || "there"},

We're excited to have you on board! RoboRoot is your gateway to mastering hardware projects and bringing your innovative ideas to life.

What's Next?
• Explore Projects: Browse our extensive library of hardware projects
• AI Project Generator: Get custom project ideas tailored to your skills
• Shop Components: Find all the parts you need in our component store
• Get Mentorship: Book sessions with experienced mentors

Go to Dashboard: https://roboroot.in/dashboard

Need help getting started? Check out our Getting Started Guide at https://roboroot.in/getting-started

Happy Building! 🔧⚡
The RoboRoot Team`,
  };
}
