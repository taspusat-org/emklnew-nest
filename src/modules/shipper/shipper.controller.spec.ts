import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ShipperController } from './shipper.controller';
import { ShipperService } from './shipper.service';

describe('ShipperController', () => {
  let controller: ShipperController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShipperController],
      providers: [ShipperService],
    }).useMocker(autoMocker).compile();

    controller = module.get<ShipperController>(ShipperController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
