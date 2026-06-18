export class AccessDeniedError extends Error {
  constructor(message: string = "Access Denied: You do not have the required permissions.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor(message: string = "Not authenticated") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
