import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const DECIMAL_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export interface SubmitOrderDecimalOptions {
  /** Maximum integer digits in the normalized value. */
  readonly maxIntegerDigits?: number;
}

/**
 * Validates the approved HTTP decimal grammar without converting the value to
 * a binary floating-point number. Leading zeroes are allowed and ignored when
 * counting integer digits; the written fractional scale is at most two.
 */
export function isPositiveSubmitOrderDecimal(
  value: unknown,
  options: SubmitOrderDecimalOptions = {},
): value is string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !DECIMAL_PATTERN.test(value)
  ) {
    return false;
  }

  const dot = value.indexOf('.');
  const integerPart = dot === -1 ? value : value.slice(0, dot);
  const fractionPart = dot === -1 ? '' : value.slice(dot + 1);
  const normalizedInteger = integerPart.replace(/^0+/, '');
  const positive =
    normalizedInteger.length > 0 || /[1-9]/.test(fractionPart);

  if (!positive) {
    return false;
  }

  if (options.maxIntegerDigits !== undefined) {
    const integerDigits =
      normalizedInteger.length === 0 ? 1 : normalizedInteger.length;

    if (integerDigits > options.maxIntegerDigits) {
      return false;
    }
  }

  return true;
}

@ValidatorConstraint({ name: 'submitOrderDecimal', async: false })
class SubmitOrderDecimalConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return isPositiveSubmitOrderDecimal(
      value,
      (args.constraints[0] ?? {}) as SubmitOrderDecimalOptions,
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a positive decimal string.`;
  }
}

export function IsSubmitOrderDecimal(
  options: SubmitOrderDecimalOptions = {},
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      constraints: [options],
      validator: SubmitOrderDecimalConstraint,
    });
  };
}
