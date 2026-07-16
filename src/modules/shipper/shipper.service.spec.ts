import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ShipperService } from './shipper.service';

describe('ShipperService', () => {
  let service: ShipperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShipperService],
    }).useMocker(autoMocker).compile();

    service = module.get<ShipperService>(ShipperService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
