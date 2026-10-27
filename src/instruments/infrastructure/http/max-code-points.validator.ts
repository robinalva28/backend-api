import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'maxCodePoints', async: false })
class MaxCodePointsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [maximum] = args.constraints as [number];

    return typeof value === 'string' && Array.from(value).length <= maximum;
  }

  defaultMessage(args: ValidationArguments): string {
    const [maximum] = args.constraints as [number];

    return `query must not exceed ${maximum} Unicode characters.`;
  }
}

export function MaxCodePoints(
  maximum: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      constraints: [maximum],
      validator: MaxCodePointsConstraint,
    });
  };
}
