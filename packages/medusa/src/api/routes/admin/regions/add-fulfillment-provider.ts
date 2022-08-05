import { defaultAdminRegionFields, defaultAdminRegionRelations } from "."

import { EntityManager } from "typeorm"
import { IsString } from "class-validator"
import { Region } from "../../../.."
import RegionService from "../../../../services/region"
import { validator } from "../../../../utils/validator"

/**
 * @oas [post] /regions/{id}/fulfillment-providers
 * operationId: "PostRegionsRegionFulfillmentProviders"
 * summary: "Add Fulfillment Provider"
 * description: "Adds a Fulfillment Provider to a Region"
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the Region.
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         required:
 *           - provider_id
 *         properties:
 *           provider_id:
 *             description: "The ID of the Fulfillment Provider to add."
 *             type: string
 * tags:
 *   - Region
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             region:
 *               $ref: "#/components/schemas/region"
 */
export default async (req, res) => {
  const { region_id } = req.params
  const validated = await validator(
    AdminPostRegionsRegionFulfillmentProvidersReq,
    req.body
  )

  const regionService: RegionService = req.scope.resolve("regionService")
  const manager: EntityManager = req.scope.resolve("manager")
  await manager.transaction(async (transactionManager) => {
    return await regionService
      .withTransaction(transactionManager)
      .addFulfillmentProvider(region_id, validated.provider_id)
  })

  const region: Region = await regionService.retrieve(region_id, {
    select: defaultAdminRegionFields,
    relations: defaultAdminRegionRelations,
  })
  res.status(200).json({ region })
}

export class AdminPostRegionsRegionFulfillmentProvidersReq {
  @IsString()
  provider_id: string
}
