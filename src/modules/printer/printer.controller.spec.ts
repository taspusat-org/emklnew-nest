import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PrinterController } from './printer.controller';
import { PrinterService } from './printer.service';

describe('PrinterController', () => {
  let controller: PrinterController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrinterController],
      providers: [PrinterService],
    }).useMocker(autoMocker).compile();

    controller = module.get<PrinterController>(PrinterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
