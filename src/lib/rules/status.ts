import type { Camp, TeacherProduct } from "@/lib/domain/knowledge";
import type { DeadlineStatus } from "@/lib/domain/rules";
import type { BusinessDate } from "@/lib/time/shanghai";
import { assertBusinessDate, isOnOrBefore } from "@/lib/time/shanghai";

export function getDeadlineStatus(
  currentDate: BusinessDate,
  deadline: string,
): DeadlineStatus {
  assertBusinessDate(currentDate);
  assertBusinessDate(deadline);
  return isOnOrBefore(currentDate, deadline) ? "active" : "expired";
}

export function getCampStatuses(
  camp: Camp,
  currentDate: BusinessDate,
): { registration: DeadlineStatus; earlyBird: DeadlineStatus } {
  return {
    registration: getDeadlineStatus(currentDate, camp.registrationDeadline),
    earlyBird: getDeadlineStatus(currentDate, camp.earlyBirdDeadline),
  };
}

export function getTeacherProductStatuses(
  product: TeacherProduct,
  currentDate: BusinessDate,
): { registration: DeadlineStatus; earlyBird: DeadlineStatus } {
  return {
    registration: getDeadlineStatus(
      currentDate,
      product.registrationDeadline,
    ),
    earlyBird: getDeadlineStatus(currentDate, product.earlyBirdDeadline),
  };
}
