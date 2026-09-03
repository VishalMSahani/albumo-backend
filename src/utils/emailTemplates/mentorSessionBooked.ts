import { wrapTemplate, type EmailTemplate } from "./base.js";

export function mentorSessionBookedTemplate(data: {
  session: {
    mentorName: string;
    mentorTitle?: string;
    date: string;
    time: string;
    duration: string;
    topic: string;
    meetLink?: string;
    sessionId?: string;
  };
  user?: {
    name: string;
  };
}): EmailTemplate {
  const content = `
    <h1>Mentor Session Confirmed! 🎓</h1>
    <p>Hi ${data.user?.name || "there"},</p>
    <p>
      Your mentor session has been successfully booked! Get ready for an insightful discussion.
    </p>

    <div class="info-box">
      <h2 style="margin-top: 0;">Session Details</h2>
      <p><strong>Mentor:</strong> ${data.session.mentorName}${data.session.mentorTitle ? ` - ${data.session.mentorTitle}` : ""}</p>
      <p><strong>Date:</strong> ${data.session.date}</p>
      <p><strong>Time:</strong> ${data.session.time}</p>
      <p><strong>Duration:</strong> ${data.session.duration}</p>
      <p><strong>Topic:</strong> ${data.session.topic}</p>
      ${data.session.meetLink ? `<p><strong>Meeting Link:</strong> <a href="${data.session.meetLink}">${data.session.meetLink}</a></p>` : ""}
    </div>

    ${
      data.session.meetLink
        ? `
    <p class="text-center">
      <a href="${data.session.meetLink}" class="button">Join Meeting (when it's time)</a>
    </p>
    `
        : ""
    }

    <h2>Prepare for Your Session</h2>
    <ul>
      <li>📝 <strong>Come prepared:</strong> Have your questions and project details ready</li>
      <li>💻 <strong>Test your setup:</strong> Ensure your camera and microphone work</li>
      <li>📚 <strong>Share resources:</strong> Have any relevant files or links ready to share</li>
      <li>⏰ <strong>Be on time:</strong> Join the meeting 2-3 minutes early</li>
    </ul>

    <p>
      <strong>Reminder:</strong> You'll receive a reminder email 24 hours before your session.
    </p>

    ${
      data.session.sessionId
        ? `
    <p class="text-center">
      <a href="https://roboroot.in/sessions/${data.session.sessionId}">View Session Details</a> | 
      <a href="https://roboroot.in/sessions/${data.session.sessionId}/reschedule">Reschedule</a>
    </p>
    `
        : ""
    }

    <p>
      Have questions before your session? Contact us at 
      <a href="mailto:mentorship@roboroot.in">mentorship@roboroot.in</a>
    </p>

    <p>
      Looking forward to your session! 🚀<br>
      The RoboRoot Team
    </p>
  `;

  return {
    subject: `Mentor Session Confirmed with ${data.session.mentorName}`,
    html: wrapTemplate(content),
    text: `Mentor Session Confirmed! 🎓

Hi ${data.user?.name || "there"},

Your mentor session has been successfully booked! Get ready for an insightful discussion.

Session Details:
Mentor: ${data.session.mentorName}${data.session.mentorTitle ? ` - ${data.session.mentorTitle}` : ""}
Date: ${data.session.date}
Time: ${data.session.time}
Duration: ${data.session.duration}
Topic: ${data.session.topic}
${data.session.meetLink ? `Meeting Link: ${data.session.meetLink}` : ""}

Prepare for Your Session:
📝 Come prepared with your questions and project details
💻 Test your camera and microphone
📚 Have any relevant files or links ready to share
⏰ Join the meeting 2-3 minutes early

Reminder: You'll receive a reminder email 24 hours before your session.

${data.session.sessionId ? `View details: https://roboroot.in/sessions/${data.session.sessionId}` : ""}

Have questions? Contact us at mentorship@roboroot.in

Looking forward to your session! 🚀
The RoboRoot Team`,
  };
}
