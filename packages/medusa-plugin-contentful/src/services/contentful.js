import _ from "lodash"
import { BaseService } from "medusa-interfaces"
import { createClient } from "contentful-management"

const IGNORE_THRESHOLD = 1 // seconds

class ContentfulService extends BaseService {
  constructor(
    { productService, redisClient, productVariantService, eventBusService },
    options
  ) {
    super()

    this.productService_ = productService

    this.productVariantService_ = productVariantService

    this.eventBus_ = eventBusService

    this.options_ = options

    this.contentful_ = createClient({
      accessToken: options.access_token,
    })

    this.redis_ = redisClient
  }

  async addIgnore_(id, side) {
    const key = `${id}_ignore_${side}`
    return await this.redis_.set(key, 1, "EX", IGNORE_THRESHOLD)
  }

  async shouldIgnore_(id, side) {
    const key = `${id}_ignore_${side}`
    return await this.redis_.get(key)
  }

  async getContentfulEnvironment_() {
    try {
      const space = await this.contentful_.getSpace(this.options_.space_id)
      const environment = await space.getEnvironment(this.options_.environment)
      return environment
    } catch (error) {
      throw error
    }
  }

  async getVariantEntries_(variants, config = { publish: false }) {
    try {
      const contentfulVariants = await Promise.all(
        variants.map(async (variant) => {
          let updated = await this.updateProductVariantInContentful(variant)
          if (config.publish) {
            updated = updated.publish()
          }

          return updated
        })
      )

      return contentfulVariants
    } catch (error) {
      throw error
    }
  }

  getVariantLinks_(variantEntries) {
    return variantEntries.map((v) => ({
      sys: {
        type: "Link",
        linkType: "Entry",
        id: v.sys.id,
      },
    }))
  }

  async createImageAssets(product) {
    const environment = await this.getContentfulEnvironment_()

    let assets = []
    await Promise.all(
      product.images
        .filter((image) => image.url !== product.thumbnail)
        .map(async (image, i) => {
          const asset = await environment.createAsset({
            fields: {
              title: {
                "en-US": `${product.title} - ${i}`,
              },
              description: {
                "en-US": "",
              },
              file: {
                "en-US": {
                  contentType: "image/xyz",
                  fileName: image.url,
                  upload: image.url,
                },
              },
            },
          })

          const finalAsset = await asset
            .processForAllLocales()
            .then((ast) => ast.publish())

          assets.push({
            sys: {
              type: "Link",
              linkType: "Asset",
              id: finalAsset.sys.id,
            },
          })
        })
    )

    return assets
  }

  getCustomField(field, type) {
    const customOptions = this.options_[`custom_${type}_fields`]

    if (customOptions) {
      return customOptions[field] || field
    } else {
      return field
    }
  }

  async createProductInContentful(product) {
    try {
      const p = await this.productService_.retrieve(product.id, {
        relations: [
          "variants",
          "options",
          "tags",
          "type",
          "collection",
          "images",
        ],
      })

      const environment = await this.getContentfulEnvironment_()
      const variantEntries = await this.getVariantEntries_(p.variants, {
        publish: true,
      })
      const variantLinks = this.getVariantLinks_(variantEntries)

      const fields = {
        [this.getCustomField("title", "product")]: {
          "en-US": p.title,
        },
        [this.getCustomField("subtitle", "product")]: {
          "en-US": p.subtitle,
        },
        [this.getCustomField("description", "product")]: {
          "en-US": p.description,
        },
        [this.getCustomField("variants", "product")]: {
          "en-US": variantLinks,
        },
        [this.getCustomField("options", "product")]: {
          "en-US": p.options,
        },
        [this.getCustomField("medusaId", "product")]: {
          "en-US": p.id,
        },
      }

      if (p.images.length > 0) {
        const imageLinks = await this.createImageAssets(product)
        if (imageLinks) {
          fields.images = {
            "en-US": imageLinks,
          }
        }
      }

      if (p.thumbnail) {
        const thumbnailAsset = await environment.createAsset({
          fields: {
            title: {
              "en-US": `${p.title}`,
            },
            description: {
              "en-US": "",
            },
            file: {
              "en-US": {
                contentType: "image/xyz",
                fileName: p.thumbnail,
                upload: p.thumbnail,
              },
            },
          },
        })

        await thumbnailAsset.processForAllLocales().then((a) => a.publish())

        const thumbnailLink = {
          sys: {
            type: "Link",
            linkType: "Asset",
            id: thumbnailAsset.sys.id,
          },
        }

        fields.thumbnail = {
          "en-US": thumbnailLink,
        }
      }

      if (p.type) {
        const type = {
          "en-US": p.type.value,
        }

        fields[this.getCustomField("type", "product")] = type
      }

      if (p.collection) {
        const collection = {
          "en-US": p.collection.title,
        }

        fields[this.getCustomField("collection", "product")] = collection
      }

      if (p.tags) {
        const tags = {
          "en-US": p.tags,
        }

        fields[this.getCustomField("tags", "product")] = tags
      }

      if (p.handle) {
        const handle = {
          "en-US": p.handle,
        }

        fields[this.getCustomField("handle", "product")] = handle
      }

      const result = await environment.createEntryWithId("product", p.id, {
        fields,
      })

      return result
    } catch (error) {
      throw error
    }
  }

  async createProductVariantInContentful(variant) {
    try {
      const v = await this.productVariantService_.retrieve(variant.id, {
        relations: ["prices", "options"],
      })

      const environment = await this.getContentfulEnvironment_()
      const result = await environment.createEntryWithId(
        "productVariant",
        v.id,
        {
          fields: {
            [this.getCustomField("title", "variant")]: {
              "en-US": v.title,
            },
            [this.getCustomField("sku", "variant")]: {
              "en-US": v.sku,
            },
            [this.getCustomField("prices", "variant")]: {
              "en-US": v.prices,
            },
            [this.getCustomField("options", "variant")]: {
              "en-US": v.options,
            },
            [this.getCustomField("medusaId", "variant")]: {
              "en-US": v.id,
            },
          },
        }
      )

      // const ignoreIds = (await this.getIgnoreIds_("product_variant")) || []
      // ignoreIds.push(v.id)
      // this.redis_.set("product_variant_ignore_ids", JSON.stringify(ignoreIds))
      return result
    } catch (error) {
      throw error
    }
  }

  async updateProductInContentful(data) {
    const updateFields = [
      "variants",
      "options",
      "tags",
      "title",
      "subtitle",
      "tags",
      "type",
      "type_id",
      "collection",
      "collection_id",
      "thumbnail",
    ]

    const found = data.fields.find((f) => updateFields.includes(f))
    if (!found) {
      return
    }

    try {
      const ignore = await this.shouldIgnore_(data.id, "contentful")
      if (ignore) {
        return
      }

      const p = await this.productService_.retrieve(data.id, {
        relations: [
          "options",
          "variants",
          "type",
          "collection",
          "tags",
          "images",
        ],
      })

      const environment = await this.getContentfulEnvironment_()
      // check if product exists
      let productEntry = undefined
      try {
        productEntry = await environment.getEntry(data.id)
      } catch (error) {
        return this.createProductInContentful(p)
      }

      const variantEntries = await this.getVariantEntries_(p.variants)
      const variantLinks = this.getVariantLinks_(variantEntries)

      const productEntryFields = {
        ...productEntry.fields,
        [this.getCustomField("title", "product")]: {
          "en-US": p.title,
        },
        [this.getCustomField("subtitle", "product")]: {
          "en-US": p.subtitle,
        },
        [this.getCustomField("description", "product")]: {
          "en-US": p.description,
        },
        [this.getCustomField("options", "product")]: {
          "en-US": p.options,
        },
        [this.getCustomField("variants", "product")]: {
          "en-US": variantLinks,
        },
        [this.getCustomField("medusaId", "product")]: {
          "en-US": p.id,
        },
      }

      if (data.fields.includes("thumbnail") && p.thumbnail) {
        let url = p.thumbnail
        if (p.thumbnail.startsWith("//")) {
          url = `https:${url}`
        }

        const thumbnailAsset = await environment.createAsset({
          fields: {
            title: {
              "en-US": `${p.title}`,
            },
            description: {
              "en-US": "",
            },
            file: {
              "en-US": {
                contentType: "image/xyz",
                fileName: url,
                upload: url,
              },
            },
          },
        })

        await thumbnailAsset.processForAllLocales().then((a) => a.publish())

        const thumbnailLink = {
          sys: {
            type: "Link",
            linkType: "Asset",
            id: thumbnailAsset.sys.id,
          },
        }

        productEntryFields.thumbnail = {
          "en-US": thumbnailLink,
        }
      }

      if (p.type) {
        const type = {
          "en-US": p.type.value,
        }

        productEntryFields[this.getCustomField("type", "product")] = type
      }

      if (p.collection) {
        const collection = {
          "en-US": p.collection.title,
        }

        productEntryFields[
          this.getCustomField("collection", "product")
        ] = collection
      }

      if (p.tags) {
        const tags = {
          "en-US": p.tags,
        }

        productEntryFields[this.getCustomField("tags", "product")] = tags
      }

      if (p.handle) {
        const handle = {
          "en-US": p.handle,
        }

        productEntryFields[this.getCustomField("handle", "product")] = handle
      }

      productEntry.fields = productEntryFields

      const updatedEntry = await productEntry.update()
      const publishedEntry = await updatedEntry.publish()

      await this.addIgnore_(data.id, "medusa")

      return publishedEntry
    } catch (error) {
      throw error
    }
  }

  async updateProductVariantInContentful(variant) {
    const updateFields = [
      "title",
      "prices",
      "sku",
      "material",
      "weight",
      "length",
      "height",
      "origin_country",
      "options",
    ]

    // Update came directly from product variant service so only act on a couple
    // of fields. When the update comes from the product we want to ensure
    // references are set up correctly so we run through everything.
    if (variant.fields) {
      const found = variant.fields.find((f) => updateFields.includes(f))
      if (!found) {
        return
      }
    }

    try {
      const ignore = await this.shouldIgnore_(variant.id, "contentful")
      if (ignore) {
        return
      }

      const environment = await this.getContentfulEnvironment_()
      // check if product exists
      let variantEntry = undefined
      // if not, we create a new one
      try {
        variantEntry = await environment.getEntry(variant.id)
      } catch (error) {
        return this.createProductVariantInContentful(variant)
      }

      const v = await this.productVariantService_.retrieve(variant.id, {
        relations: ["prices", "options"],
      })

      const variantEntryFields = {
        ...variantEntry.fields,
        [this.getCustomField("title", "variant")]: {
          "en-US": v.title,
        },
        [this.getCustomField("sku", "variant")]: {
          "en-US": v.sku,
        },
        [this.getCustomField("options", "variant")]: {
          "en-US": v.options,
        },
        [this.getCustomField("prices", "variant")]: {
          "en-US": v.prices,
        },
        [this.getCustomField("medusaId", "variant")]: {
          "en-US": v.id,
        },
      }

      variantEntry.fields = variantEntryFields

      const updatedEntry = await variantEntry.update()
      const publishedEntry = await updatedEntry.publish()

      await this.addIgnore_(variant.id, "medusa")

      return publishedEntry
    } catch (error) {
      throw error
    }
  }

  async sendContentfulProductToAdmin(productId) {
    const ignore = await this.shouldIgnore_(productId, "medusa")
    if (ignore) {
      return
    }

    try {
      const environment = await this.getContentfulEnvironment_()
      const productEntry = await environment.getEntry(productId)

      const product = await this.productService_.retrieve(productId)

      let update = {}

      const title =
        productEntry.fields[this.getCustomField("title", "product")]["en-US"]

      const subtitle =
        productEntry.fields[this.getCustomField("subtitle", "product")]["en-US"]

      const description =
        productEntry.fields[this.getCustomField("description", "product")][
          "en-US"
        ]

      if (product.title !== title) {
        update.title = title
      }

      if (product.subtitle !== subtitle) {
        update.subtitle = subtitle
      }

      if (product.description !== description) {
        update.description = description
      }

      // Get the thumbnail, if present
      if (productEntry.fields.thumbnail) {
        const thumb = await environment.getAsset(
          productEntry.fields.thumbnail["en-US"].sys.id
        )

        if (thumb.fields.file["en-US"].url) {
          if (!product.thumbnail.includes(thumb.fields.file["en-US"].url)) {
            update.thumbnail = thumb.fields.file["en-US"].url
          }
        }
      }

      if (!_.isEmpty(update)) {
        await this.productService_.update(productId, update).then(async () => {
          return await this.addIgnore_(productId, "contentful")
        })
      }
    } catch (error) {
      throw error
    }
  }

  async sendContentfulProductVariantToAdmin(variantId) {
    const ignore = this.shouldIgnore_(variantId, "medusa")
    if (ignore) {
      return
    }

    try {
      const environment = await this.getContentfulEnvironment_()
      const variantEntry = await environment.getEntry(variantId)

      const updatedVariant = await this.productVariantService_
        .update(variantId, {
          title:
            variantEntry.fields[this.getCustomField("title", "variant")][
              "en-US"
            ],
        })
        .then(async () => {
          return await this.addIgnore_(variantId, "contentful")
        })

      return updatedVariant
    } catch (error) {
      throw error
    }
  }

  async getType(type) {
    const environment = await this.getContentfulEnvironment_()
    return environment.getContentType(type)
  }
}

export default ContentfulService
