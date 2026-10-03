import {
  collectForms,
  detectHumanCheckpoints,
  fieldLocator,
  findAccountCreationLink,
  type FormDescriptor,
  type FormFieldDescriptor
} from "@linktide/browser";
import type { Locator, Page } from "playwright";

export type AccountCredential = {
  email: string;
  username?: string;
  password: string;
};

export type AccountActionResult = {
  status:
    | "logged_in"
    | "created"
    | "verification_required"
    | "human_action_required"
    | "failed";
  checkpoints: string[];
  reason?: string;
  signupUrl?: string;
  filled: string[];
};

function textFor(field: FormFieldDescriptor) {
  return `${field.name} ${field.id} ${field.label} ${field.placeholder}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function scoreAuthForm(form: FormDescriptor, mode: "login" | "signup") {
  const passwordCount = form.fields.filter((field) => field.type === "password").length;
  const emailCount = form.fields.filter(
    (field) => field.type === "email" || /email|user name|username/.test(textFor(field))
  ).length;

  let score = passwordCount * 6 + emailCount * 4;
  if (mode === "signup" && passwordCount >= 2) score += 5;
  if (mode === "login" && passwordCount === 1) score += 4;
  return score;
}

function chooseAuthForm(forms: FormDescriptor[], mode: "login" | "signup") {
  return forms
    .slice()
    .sort((a, b) => scoreAuthForm(b, mode) - scoreAuthForm(a, mode))[0];
}

async function safeFill(locator: Locator, value: string) {
  try {
    if (!(await locator.isVisible())) return false;
    await locator.fill(value);
    return true;
  } catch {
    return false;
  }
}

function splitName(value?: string) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] ?? "",
    last: parts.slice(1).join(" ")
  };
}

async function fillAuthForm(input: {
  page: Page;
  form: FormDescriptor;
  credential: AccountCredential;
  contactName?: string;
  mode: "login" | "signup";
}) {
  const filled: string[] = [];
  const name = splitName(input.contactName);
  let passwordIndex = 0;

  for (const field of input.form.fields) {
    const meta = textFor(field);
    const locator = fieldLocator(input.page, field);

    if (field.type === "checkbox" || field.type === "radio") continue;

    if (field.type === "email" || /(^| )email( |$)/.test(meta)) {
      if (await safeFill(locator, input.credential.email)) filled.push(field.key);
      continue;
    }

    if (
      field.type === "password" ||
      /password|pass word|confirm password|repeat password/.test(meta)
    ) {
      if (await safeFill(locator, input.credential.password)) filled.push(field.key);
      passwordIndex += 1;
      continue;
    }

    if (/user name|username|login name/.test(meta)) {
      const username =
        input.credential.username ??
        input.credential.email.split("@")[0];
      if (await safeFill(locator, username)) filled.push(field.key);
      continue;
    }

    if (input.mode === "signup" && /first name|given name/.test(meta) && name.first) {
      if (await safeFill(locator, name.first)) filled.push(field.key);
      continue;
    }

    if (input.mode === "signup" && /last name|surname|family name/.test(meta) && name.last) {
      if (await safeFill(locator, name.last)) filled.push(field.key);
      continue;
    }

    if (
      input.mode === "signup" &&
      /full name|your name|contact name|^name$/.test(meta) &&
      input.contactName
    ) {
      if (await safeFill(locator, input.contactName)) filled.push(field.key);
    }
  }

  const requiredUnfilled = input.form.fields.filter((field) => {
    if (!field.required) return false;
    if (["checkbox", "radio"].includes(field.type)) return false;
    return !filled.includes(field.key);
  });

  return { filled, requiredUnfilled, passwordIndex };
}

async function findAuthSubmit(
  page: Page,
  form: FormDescriptor,
  mode: "login" | "signup"
) {
  const formLocator = page.locator("form").nth(form.formIndex);
  const buttons = formLocator.locator(
    'button, input[type="submit"], input[type="button"]'
  );

  const candidates = await buttons.evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const el = node as HTMLButtonElement | HTMLInputElement;
      return {
        index,
        text:
          (el instanceof HTMLInputElement ? el.value : el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
      };
    })
  );

  const positive =
    mode === "login"
      ? /(log in|login|sign in|continue|submit)/
      : /(create account|sign up|signup|register|join|create profile|continue)/;
  const dangerous = /(pay|purchase|checkout|buy|subscribe|charge)/;

  const best = candidates
    .map((candidate) => ({
      ...candidate,
      score:
        (positive.test(candidate.text) ? 10 : 0) -
        (dangerous.test(candidate.text) ? 100 : 0)
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score <= 0) return undefined;
  return buttons.nth(best.index);
}

function blockingCheckpoints(checkpoints: string[]) {
  return checkpoints.filter(
    (checkpoint) => checkpoint !== "account_auth"
  );
}

export async function loginWithCredential(input: {
  page: Page;
  credential: AccountCredential;
}) : Promise<AccountActionResult> {
  const forms = await collectForms(input.page);
  const form = chooseAuthForm(forms, "login");

  if (!form) {
    return {
      status: "failed",
      checkpoints: [],
      reason: "No login form was found.",
      filled: []
    };
  }

  const filled = await fillAuthForm({
    page: input.page,
    form,
    credential: input.credential,
    mode: "login"
  });

  const checkpoints = blockingCheckpoints(
    await detectHumanCheckpoints(input.page)
  );

  if (checkpoints.length) {
    return {
      status: "human_action_required",
      checkpoints,
      reason: "Login page requires human action.",
      filled: filled.filled
    };
  }

  if (filled.requiredUnfilled.length) {
    return {
      status: "human_action_required",
      checkpoints: [],
      reason: `${filled.requiredUnfilled.length} required login field(s) could not be filled safely.`,
      filled: filled.filled
    };
  }

  const submit = await findAuthSubmit(input.page, form, "login");
  if (!submit) {
    return {
      status: "human_action_required",
      checkpoints: [],
      reason: "No safe login button was found.",
      filled: filled.filled
    };
  }

  await submit.click();
  await input.page.waitForTimeout(1400);

  const after = await detectHumanCheckpoints(input.page);
  const blockers = blockingCheckpoints(after);

  if (blockers.length) {
    return {
      status: "human_action_required",
      checkpoints: blockers,
      reason: "Login requires additional human action.",
      filled: filled.filled
    };
  }

  if (after.includes("account_auth")) {
    return {
      status: "failed",
      checkpoints: after,
      reason: "The site still appears to be on an authentication form.",
      filled: filled.filled
    };
  }

  return {
    status: "logged_in",
    checkpoints: [],
    filled: filled.filled
  };
}

export async function createDirectoryAccount(input: {
  page: Page;
  credential: AccountCredential;
  contactName?: string;
}) : Promise<AccountActionResult> {
  let signupUrl = input.page.url();
  let forms = await collectForms(input.page);
  let form = chooseAuthForm(forms, "signup");

  const currentLooksLikeSignup =
    form &&
    scoreAuthForm(form, "signup") >= 15 &&
    form.fields.filter((field) => field.type === "password").length >= 2;

  if (!currentLooksLikeSignup) {
    const link = await findAccountCreationLink(input.page);
    if (!link) {
      return {
        status: "human_action_required",
        checkpoints: ["account_auth"],
        reason: "An account is required, but LinkTide could not find a safe signup link.",
        filled: []
      };
    }

    signupUrl = link.url;
    await input.page.goto(link.url, {
      waitUntil: "domcontentloaded",
      timeout: 35_000
    });

    forms = await collectForms(input.page);
    form = chooseAuthForm(forms, "signup");
  }

  if (!form) {
    return {
      status: "human_action_required",
      checkpoints: [],
      reason: "Signup page found, but no usable signup form was detected.",
      signupUrl,
      filled: []
    };
  }

  const filled = await fillAuthForm({
    page: input.page,
    form,
    credential: input.credential,
    contactName: input.contactName,
    mode: "signup"
  });

  const checkpoints = blockingCheckpoints(
    await detectHumanCheckpoints(input.page)
  );

  if (checkpoints.length) {
    return {
      status: "human_action_required",
      checkpoints,
      reason: "Signup page requires human action before account creation.",
      signupUrl,
      filled: filled.filled
    };
  }

  if (filled.requiredUnfilled.length) {
    return {
      status: "human_action_required",
      checkpoints: [],
      reason: `${filled.requiredUnfilled.length} required signup field(s) could not be filled safely.`,
      signupUrl,
      filled: filled.filled
    };
  }

  const submit = await findAuthSubmit(input.page, form, "signup");
  if (!submit) {
    return {
      status: "human_action_required",
      checkpoints: [],
      reason: "No safe account-creation button was found.",
      signupUrl,
      filled: filled.filled
    };
  }

  await submit.click();
  await input.page.waitForTimeout(1600);

  const after = await detectHumanCheckpoints(input.page);

  if (
    after.includes("email_verification") ||
    after.includes("verification_code")
  ) {
    return {
      status: "verification_required",
      checkpoints: after,
      reason: "The new account is waiting for email or code verification.",
      signupUrl,
      filled: filled.filled
    };
  }

  const blockers = blockingCheckpoints(after);
  if (blockers.length) {
    return {
      status: "human_action_required",
      checkpoints: blockers,
      reason: "Account creation requires additional human action.",
      signupUrl,
      filled: filled.filled
    };
  }

  if (after.includes("account_auth")) {
    return {
      status: "failed",
      checkpoints: after,
      reason: "The site remained on an account form after submission.",
      signupUrl,
      filled: filled.filled
    };
  }

  return {
    status: "created",
    checkpoints: [],
    signupUrl,
    filled: filled.filled
  };
}
