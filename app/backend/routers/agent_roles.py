import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.agent_roles import Agent_rolesService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/agent_roles", tags=["agent_roles"])


# ---------- Pydantic Schemas ----------
class Agent_rolesData(BaseModel):
    """Entity data schema (for create/update)"""
    name: str
    profile: str
    goal: str
    system_prompt: str
    subscribe_types: str
    publish_type: str
    artifact_kind: str
    sop_order: int
    enabled: bool


class Agent_rolesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    name: Optional[str] = None
    profile: Optional[str] = None
    goal: Optional[str] = None
    system_prompt: Optional[str] = None
    subscribe_types: Optional[str] = None
    publish_type: Optional[str] = None
    artifact_kind: Optional[str] = None
    sop_order: Optional[int] = None
    enabled: Optional[bool] = None


class Agent_rolesResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    name: str
    profile: str
    goal: str
    system_prompt: str
    subscribe_types: str
    publish_type: str
    artifact_kind: str
    sop_order: int
    enabled: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Agent_rolesListResponse(BaseModel):
    """List response schema"""
    items: List[Agent_rolesResponse]
    total: int
    skip: int
    limit: int


class Agent_rolesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Agent_rolesData]


class Agent_rolesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Agent_rolesUpdateData


class Agent_rolesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Agent_rolesBatchUpdateItem]


class Agent_rolesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Agent_rolesListResponse)
async def query_agent_roless(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query agent_roless with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying agent_roless: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Agent_rolesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} agent_roless")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid agent_roles query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying agent_roless: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Agent_rolesResponse)
async def get_agent_roles(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single agent_roles by ID (user can only see their own records)"""
    logger.debug(f"Fetching agent_roles with id: {id}, fields={fields}")
    
    service = Agent_rolesService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Agent_roles with id {id} not found")
            raise HTTPException(status_code=404, detail="Agent_roles not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching agent_roles {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Agent_rolesResponse, status_code=201)
async def create_agent_roles(
    data: Agent_rolesData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new agent_roles"""
    logger.debug(f"Creating new agent_roles with data: {data}")
    
    service = Agent_rolesService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create agent_roles")
        
        logger.info(f"Agent_roles created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating agent_roles: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating agent_roles: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Agent_rolesResponse], status_code=201)
async def create_agent_roless_batch(
    request: Agent_rolesBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple agent_roless in a single request"""
    logger.debug(f"Batch creating {len(request.items)} agent_roless")
    
    service = Agent_rolesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} agent_roless successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Agent_rolesResponse])
async def update_agent_roless_batch(
    request: Agent_rolesBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple agent_roless in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} agent_roless")
    
    service = Agent_rolesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} agent_roless successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Agent_rolesResponse)
async def update_agent_roles(
    id: int,
    data: Agent_rolesUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing agent_roles (requires ownership)"""
    logger.debug(f"Updating agent_roles {id} with data: {data}")

    service = Agent_rolesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Agent_roles with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Agent_roles not found")
        
        logger.info(f"Agent_roles {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating agent_roles {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating agent_roles {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_agent_roless_batch(
    request: Agent_rolesBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple agent_roless by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} agent_roless")
    
    service = Agent_rolesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} agent_roless successfully")
        return {"message": f"Successfully deleted {deleted_count} agent_roless", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_agent_roles(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single agent_roles by ID (requires ownership)"""
    logger.debug(f"Deleting agent_roles with id: {id}")
    
    service = Agent_rolesService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Agent_roles with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Agent_roles not found")
        
        logger.info(f"Agent_roles {id} deleted successfully")
        return {"message": "Agent_roles deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting agent_roles {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")