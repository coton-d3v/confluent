import { BadRequestException } from '@nestjs/common'
import type { AnswerValidationError } from './answer-validation'

// Raised when a batch of answers does not fit the dossier's questionnaire version. HTTP callers get a
// 400 with one entry per faulty field in `error.details`; the MCP layer reads `errors` directly.
export class InvalidAnswersException extends BadRequestException {
  constructor(readonly errors: AnswerValidationError[]) {
    super({ message: 'Some answers are invalid.', details: errors })
  }
}
