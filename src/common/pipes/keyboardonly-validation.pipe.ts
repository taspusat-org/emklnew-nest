import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
@Injectable()
export class KeyboardOnlyValidationPipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === 'object' && value !== null) {
      Object.keys(value).forEach((key) => {
        const propValue = value[key];

        if (typeof propValue === 'string') {
          for (let i = 0; i < propValue.length; i++) {
            const charCode = propValue.charCodeAt(i);

            if (!(charCode >= 32 && charCode <= 126)) {
              throw new BadRequestException(
                `Terdapat Karakter tidak diperbolehkan di ${key}: ${propValue[i]}`,
              );
            }
          }
        }
      });
    }

    return value;
  }
}
