import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

type RequestPart = "body" | "params" | "query";
type RequestSchemas = Partial<Record<RequestPart, z.ZodType<unknown>>>;

export function validate(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const [part, schema] of Object.entries(schemas) as [RequestPart, z.ZodType<unknown>][]) {
      const result = schema.safeParse(req[part]);

      if (!result.success) {
        const message = result.error.issues
          .map((issue) => `${issue.path.join(".") || part}: ${issue.message}`)
          .join("; ");

        res.status(400).json({
          success: false,
          error: message,
          code: "VALIDATION_ERROR",
        });
        return;
      }

      if (part === "body") {
        req.body = result.data;
      }
    }

    next();
  };
}
