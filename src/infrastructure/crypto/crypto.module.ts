import { Global, Module } from "@nestjs/common";

import { FieldEncryptionService } from "./field-encryption.service";
import { SecretHasherService } from "./secret-hasher.service";

@Global()
@Module({ providers: [FieldEncryptionService, SecretHasherService], exports: [FieldEncryptionService, SecretHasherService] })
export class CryptoModule {}
