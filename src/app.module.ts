import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { MailModule } from './common/mail/mail.module';
import { ConfigModule } from '@nestjs/config';
import { AuthMiddleware } from './common/middlewares/auth.middleware';
import { UtilsModule } from './utils/utils.module';
import { RedisModule } from './common/redis/redis.module';
import { RedisController } from './common/redis/redis.controller';
import { SocketModule } from './common/socket/socket.module';
import { AcosModule } from './modules/acos/acos.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { ErrorModule } from './modules/error/error.module';
import { ParameterModule } from './modules/parameter/parameter.module';
import { RedisService } from './common/redis/redis.service';
import { LogtrailModule } from './common/logtrail/logtrail.module';
import { MenuModule } from './modules/menu/menu.module';
import { RoleModule } from './modules/role/role.module';
import { UserModule } from './modules/user/user.module';
import { OffdaysModule } from './modules/offdays/offdays.module';
import { RoleaclModule } from './modules/roleacl/roleacl.module';
import { UseraclModule } from './modules/useracl/useracl.module';
import { UserroleModule } from './modules/userrole/userrole.module';
import { CacheModule } from '@nestjs/cache-manager';
import { RunningNumberModule } from './modules/running-number/running-number.module';
import { KnexModule } from './modules/knex/knex.module';
import { FieldlengthModule } from './modules/fieldlength/fieldlength.module';
import { CabangModule } from './modules/cabang/cabang.module';
import { RabbitmqModule } from './modules/rabbitmq/rabbitmq.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RabbitmqService } from './modules/rabbitmq/rabbitmq.service';
import { RabbitmqClientModule } from './modules/rabbitmq-client/rabbitmq-client.module';
import { PengembaliankasgantungheaderModule } from './modules/pengembaliankasgantungheader/pengembaliankasgantungheader.module';
import { PengembaliankasgantungdetailModule } from './modules/pengembaliankasgantungdetail/pengembaliankasgantungdetail.module';
import { KasgantungheaderModule } from './modules/kasgantungheader/kasgantungheader.module';
import { KasgantungdetailModule } from './modules/kasgantungdetail/kasgantungdetail.module';
import { JurnalumumheaderModule } from './modules/jurnalumumheader/jurnalumumheader.module';
import { JurnalumumdetailModule } from './modules/jurnalumumdetail/jurnalumumdetail.module';
import { RelasiModule } from './modules/relasi/relasi.module';
import { AlatbayarModule } from './modules/alatbayar/alatbayar.module';
import { BankModule } from './modules/bank/bank.module';
import { ContainerModule } from './modules/container/container.module';
import { PelayaranModule } from './modules/pelayaran/pelayaran.module';
import { JenisMuatanModule } from './modules/jenismuatan/jenismuatan.module';

import { AkuntansiModule } from './modules/akuntansi/akuntansi.module';
import { GlobalModule } from './modules/global/global.module';
import { AkunpusatModule } from './modules/akunpusat/akunpusat.module';
import { KapalModule } from './modules/kapal/kapal.module';
import { TypeAkuntansiModule } from './modules/type-akuntansi/type-akuntansi.module';
import { ScheduleHeaderModule } from './modules/schedule-header/schedule-header.module';
import { ScheduleDetailModule } from './modules/schedule-detail/schedule-detail.module';
import { JenisOrderanModule } from './modules/jenisorderan/jenisorderan.module';
import { DaftarBankModule } from './modules/daftarbank/daftarbank.module';

import { TujuankapalModule } from './modules/tujuankapal/tujuankapal.module';
import { LocksModule } from './modules/locks/locks.module';
import { HargatruckingModule } from './modules/hargatrucking/hargatrucking.module';
import { EmklModule } from './modules/emkl/emkl.module';
import { ScheduleKapalModule } from './modules/schedule-kapal/schedule-kapal.module';
import { AsalkapalModule } from './modules/asalkapal/asalkapal.module';
import { SandarkapalModule } from './modules/sandarkapal/sandarkapal.module';
import { ManagermarketingheaderModule } from './modules/managermarketingheader/managermarketingheader.module';
import { ManagermarketingdetailModule } from './modules/managermarketingdetail/managermarketingdetail.module';
import { DaftarblModule } from './modules/daftarbl/daftarbl.module';
import { JenisbiayamarketingModule } from './modules/jenisbiayamarketing/jenisbiayamarketing.module';
import { MarketinggroupModule } from './modules/marketinggroup/marketinggroup.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { MarketingorderanModule } from './modules/marketingorderan/marketingorderan.module';
import { MarketingbiayaModule } from './modules/marketingbiaya/marketingbiaya.module';
import { MarketingmanagerModule } from './modules/marketingmanager/marketingmanager.module';
import { MarketingprosesfeeModule } from './modules/marketingprosesfee/marketingprosesfee.module';
import { MarketingdetailModule } from './modules/marketingdetail/marketingdetail.module';
import { JenisprosesfeeModule } from './modules/jenisprosesfee/jenisprosesfee.module';
import { DivisiModule } from './modules/divisi/divisi.module';
import { JabatanModule } from './modules/jabatan/jabatan.module';
import { ShipperModule } from './modules/shipper/shipper.module';
import { PengeluaranheaderModule } from './modules/pengeluaranheader/pengeluaranheader.module';
import { PengeluarandetailModule } from './modules/pengeluarandetail/pengeluarandetail.module';
import { PenerimaanheaderModule } from './modules/penerimaanheader/penerimaanheader.module';
import { PenerimaandetailModule } from './modules/penerimaandetail/penerimaandetail.module';
import { BiayaModule } from './modules/biaya/biaya.module';
import { BiayaemklModule } from './modules/biayaemkl/biayaemkl.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { HutangheaderModule } from './modules/hutangheader/hutangheader.module';
import { HutangdetailModule } from './modules/hutangdetail/hutangdetail.module';
import { PenerimaanEmklModule } from './modules/penerimaan-emkl/penerimaan-emkl.module';
import { PengeluaranEmklModule } from './modules/pengeluaran-emkl/pengeluaran-emkl.module';
import { PengeluaranemklheaderModule } from './modules/pengeluaranemklheader/pengeluaranemklheader.module';
import { PengeluaranemkldetailModule } from './modules/pengeluaranemkldetail/pengeluaranemkldetail.module';
import { KaryawanModule } from './modules/karyawan/karyawan.module';
import { MasterbiayaModule } from './modules/masterbiaya/masterbiaya.module';
import { PindahBukuModule } from './modules/pindah-buku/pindah-buku.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AclGuard } from './modules/auth/acl.guard';
import { UtilsService } from './utils/utils.service';
import { StatuspendukungModule } from './modules/statuspendukung/statuspendukung.module';
import { JenissealModule } from './modules/jenisseal/jenisseal.module';
import { LabaRugiKalkulasiModule } from './modules/laba-rugi-kalkulasi/laba-rugi-kalkulasi.module';
import { PenerimaanemklheaderModule } from './modules/penerimaanemklheader/penerimaanemklheader.module';
import { PenerimaanemkldetailModule } from './modules/penerimaanemkldetail/penerimaanemkldetail.module';
import { BookingOrderanHeaderModule } from './modules/booking-orderan-header/booking-orderan-header.module';
import { TradoModule } from './modules/trado/trado.module';
import { GandenganModule } from './modules/gandengan/gandengan.module';
import { PrinterModule } from './modules/printer/printer.module';
import { StatusjobModule } from './modules/statusjob/statusjob.module';
// import { ThrottlerModule } from '@nestjs/throttler';
// import { ThrottlerGuard } from '@nestjs/throttler';
import { OrderanHeaderModule } from './modules/orderan-header/orderan-header.module';
import { ComodityModule } from './modules/comodity/comodity.module';
import { PackinglistheaderModule } from './modules/packinglistheader/packinglistheader.module';
import { PackinglistdetailModule } from './modules/packinglistdetail/packinglistdetail.module';
import { PackinglistdetailrincianModule } from './modules/packinglistdetailrincian/packinglistdetailrincian.module';
import { ShippingInstructionModule } from './modules/shipping-instruction/shipping-instruction.module';
import { ShippingInstructionDetailModule } from './modules/shipping-instruction-detail/shipping-instruction-detail.module';
import { ShippingInstructionDetailRincianModule } from './modules/shipping-instruction-detail-rincian/shipping-instruction-detail-rincian.module';
import { BlHeaderModule } from './modules/bl-header/bl-header.module';
import { BlDetailRincianModule } from './modules/bl-detail-rincian/bl-detail-rincian.module';
import { BlDetailModule } from './modules/bl-detail/bl-detail.module';
import { BlDetailRincianBiayaModule } from './modules/bl-detail-rincian-biaya/bl-detail-rincian-biaya.module';
import { BiayaExtraHeaderModule } from './modules/biaya-extra-header/biaya-extra-header.module';
import { BiayaExtraMuatanDetailModule } from './modules/biaya-extra-muatan-detail/biaya-extra-muatan-detail.module';
import { GroupbiayaextraModule } from './modules/groupbiayaextra/groupbiayaextra.module';
import { ConsigneeModule } from './modules/consignee/consignee.module';
import { ConsigneedetailModule } from './modules/consigneedetail/consigneedetail.module';
import { ConsigneebiayaModule } from './modules/consigneebiaya/consigneebiaya.module';
import { ConsigneehargajualModule } from './modules/consigneehargajual/consigneehargajual.module';
import { PanjarheaderModule } from './modules/panjarheader/panjarheader.module';
import { PanjarmuatandetailModule } from './modules/panjarmuatandetail/panjarmuatandetail.module';
import { EmailvalidationModule } from './modules/emailvalidation/emailvalidation.module';
import { TesmoduleModule } from './modules/tesmodule/tesmodule.module';
import { EstimasiBiayaDetailBiayaModule } from './modules/estimasi-biaya-detail-biaya/estimasi-biaya-detail-biaya.module';
import { EstimasiBiayaHeaderModule } from './modules/estimasi-biaya-header/estimasi-biaya-header.module';
import { EstimasiBiayaDetailInvoiceModule } from './modules/estimasi-biaya-detail-invoice/estimasi-biaya-detail-invoice.module';
import { BiayaHeaderModule } from './modules/biaya-header/biaya-header.module';
import { BiayaMuatanDetailModule } from './modules/biaya-muatan-detail/biaya-muatan-detail.module';

@Module({
  imports: [
    CacheModule.register(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // ThrottlerModule.forRoot({
    //   throttlers: [
    //     {
    //       ttl: 60000,
    //       limit: 10,
    //     },
    //   ],
    // }),
    AuthModule,
    MailModule,
    AcosModule,
    ErrorModule,
    ParameterModule,
    UtilsModule,
    RedisModule,
    LogtrailModule,
    SocketModule,
    MenuModule,
    RoleModule,
    UserModule,
    OffdaysModule,
    RoleaclModule,
    UseraclModule,
    KnexModule,
    UserroleModule,
    RunningNumberModule,
    FieldlengthModule,
    CabangModule,
    RabbitmqModule,
    RabbitmqClientModule,
    PengembaliankasgantungheaderModule,
    PengembaliankasgantungdetailModule,
    KasgantungheaderModule,
    KasgantungdetailModule,
    JurnalumumheaderModule,
    JurnalumumdetailModule,
    RelasiModule,
    AlatbayarModule,
    BankModule,
    ContainerModule,

    AkunpusatModule,
    GlobalModule,
    PelayaranModule,
    JenisMuatanModule,
    AkuntansiModule,
    KapalModule,
    TypeAkuntansiModule,
    ScheduleHeaderModule,
    ScheduleDetailModule,
    JenisOrderanModule,
    DaftarBankModule,
    TujuankapalModule,
    LocksModule,
    HargatruckingModule,
    EmklModule,
    ScheduleKapalModule,
    EmklModule,
    AsalkapalModule,
    SandarkapalModule,
    ManagermarketingheaderModule,
    ManagermarketingdetailModule,
    DaftarblModule,
    JenisbiayamarketingModule,
    MarketinggroupModule,
    MarketingModule,
    MarketingorderanModule,
    MarketingbiayaModule,
    MarketingmanagerModule,
    MarketingprosesfeeModule,
    MarketingdetailModule,
    JenisprosesfeeModule,
    DivisiModule,
    JabatanModule,
    ShipperModule,
    PengeluaranheaderModule,
    PengeluarandetailModule,
    PenerimaanheaderModule,
    PenerimaandetailModule,
    BiayaModule,
    BiayaemklModule,
    SupplierModule,
    HutangheaderModule,
    HutangdetailModule,
    PenerimaanEmklModule,
    PengeluaranEmklModule,
    PengeluaranemklheaderModule,
    PengeluaranemkldetailModule,
    KaryawanModule,
    MasterbiayaModule,
    PindahBukuModule,
    StatuspendukungModule,
    JenissealModule,
    LabaRugiKalkulasiModule,
    PenerimaanemklheaderModule,
    PenerimaanemkldetailModule,
    BookingOrderanHeaderModule,
    TradoModule,
    GandenganModule,
    PrinterModule,
    StatusjobModule,
    OrderanHeaderModule,
    ComodityModule,
    PackinglistheaderModule,
    PackinglistdetailModule,
    PackinglistdetailrincianModule,
    ShippingInstructionModule,
    ShippingInstructionDetailModule,
    ShippingInstructionDetailRincianModule,
    BlHeaderModule,
    BlDetailRincianModule,
    BlDetailModule,
    BlDetailRincianBiayaModule,
    BiayaExtraHeaderModule,
    BiayaExtraMuatanDetailModule,
    GroupbiayaextraModule,
    ConsigneeModule,
    ConsigneedetailModule,
    ConsigneebiayaModule,
    ConsigneehargajualModule,
    PanjarheaderModule,
    PanjarmuatandetailModule,
    EmailvalidationModule,
    TesmoduleModule,
    EstimasiBiayaDetailBiayaModule,
    EstimasiBiayaHeaderModule,
    EstimasiBiayaDetailInvoiceModule,
    BiayaHeaderModule,
    BiayaMuatanDetailModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    RabbitmqService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .exclude(
        // 'offdays',
        { path: 'bot/(.*)', method: RequestMethod.ALL },
        { path: 'email-validation/(.*)', method: RequestMethod.ALL },
        { path: 'shipper/(.*)', method: RequestMethod.ALL },
        { path: 'shipper', method: RequestMethod.ALL },
        'auth/*', // Exclude all routes under the 'auth' path
        'menu/*', // Exclude all routes under the 'menu' path
        // 'offdays/*', // Exclude all routes under the 'offdays' path
        'redis/*', // Exclude all routes under the 'redis' path
        'uploads/*', // Exclude all routes under the 'uploads' path
        'sse/*', // Exclude all routes under the 'sse' path
      )
      .forRoutes('*');
  }
}
